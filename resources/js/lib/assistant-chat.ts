/**
 * Assistant chat state and tool loop. POST /assistant/chat (AssistantController)
 * streams one model turn; when the model asks for tools, they run here in the
 * browser via runAssistantCommand (changes wait for the user's click), and the
 * results go back in the next turn. Module-level so the conversation survives
 * Inertia page visits (pages wrap themselves in AppLayout, which remounts).
 *
 * Each conversation is also saved per user (/assistant/conversations) so it can be
 * continued after a reload, and its context is kept small: old tool output is
 * clipped and, past a size, the oldest messages are summarized (/assistant/compact)
 * into `summary`, which rides along with every request.
 */
import { useSyncExternalStore } from 'react';
import {
    assistantTools,
    commandRisk,
    inputProblem,
    needsConfirmation,
    runAssistantCommand,
} from '@/lib/assistant-commands';
import type { CommandResult, Risk } from '@/lib/assistant-commands';
import {
    estimateChars,
    pickCut,
    repairApi,
    repairCards,
    shrinkOldResults,
} from '@/lib/assistant-memory';
import type { ApiMessage, ToolCall } from '@/lib/assistant-memory';
import { csrfHeaders } from '@/lib/csrf-fetch';

export type ToolStatus = 'awaiting' | 'running' | 'done' | 'failed' | 'denied';
export type ToolMessage = {
    id: number;
    kind: 'tool';
    name: string;
    input: Record<string, unknown>;
    risk: Risk;
    status: ToolStatus;
    loggerName?: string;
    result?: string;
    /** Card-only extra from CommandResult.view. */
    view?: unknown;
};
export type ChatMessage =
    | { id: number; kind: 'user'; text: string }
    | { id: number; kind: 'assistant'; text: string; error?: string }
    /** Small muted line, e.g. "older context was summarized"; `key` is a chat.* locale key. */
    | { id: number; kind: 'note'; key: string }
    | ToolMessage;
export type ConversationInfo = {
    id: number;
    title: string | null;
    updated_at: string;
};

type ChatState = {
    open: boolean;
    /** Desktop panel width in px, set by dragging its left edge. */
    width: number;
    busy: boolean;
    messages: ChatMessage[];
    /** Saved chat being shown; null until the first save of a new one. */
    conversationId: number | null;
    conversations: ConversationInfo[];
};
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

const STORAGE_KEY = 'cloud-beacon.chat-open';
const WIDTH_KEY = 'cloud-beacon.chat-width';
export const CHAT_MIN_WIDTH = 320;
export const CHAT_MAX_WIDTH = 900;
export const CHAT_DEFAULT_WIDTH = 352; // w-88
const MAX_ROUNDS = 10; // model turns per user message
const MAX_HISTORY = 60; // messages sent per request
const MAX_RESULT_CHARS = 12000;
const COMPACT_AT = 36000; // chars of history (~10k tokens) before older turns are summarized
const KEEP_RECENT = 12000; // chars of the newest turns kept verbatim when summarizing
const RESUME_WITHIN_MS = 12 * 60 * 60 * 1000; // reopen the last chat if it is this fresh

const clampWidth = (w: number) =>
    Math.round(Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, w)));

function readWidth(): number {
    try {
        const saved = Number(localStorage.getItem(WIDTH_KEY));
        return saved ? clampWidth(saved) : CHAT_DEFAULT_WIDTH;
    } catch {
        return CHAT_DEFAULT_WIDTH;
    }
}

function readOpen(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

let state: ChatState = {
    open: readOpen(),
    width: readWidth(),
    busy: false,
    messages: [],
    conversationId: null,
    conversations: [],
};
let nextId = 1;
let history: ApiMessage[] = [];
// Memory of the messages that were compacted away; sent with every request.
let summary = '';
let abort: AbortController | null = null;
const approvals = new Map<number, (approved: boolean) => void>();
// Logger names seen in tool results, so approval cards can say which logger.
const loggerNames = new Map<string, string>();
const listeners = new Set<() => void>();

function update(patch: Partial<ChatState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
}

function push(message: WithoutId<ChatMessage>): number {
    const id = nextId++;
    update({
        messages: [...state.messages, { ...message, id } as ChatMessage],
    });
    return id;
}

function patch(id: number, changes: Record<string, unknown>) {
    update({
        messages: state.messages.map((m) =>
            m.id === id ? ({ ...m, ...changes } as ChatMessage) : m,
        ),
    });
}

function remove(id: number) {
    update({ messages: state.messages.filter((m) => m.id !== id) });
}

export function useChatState() {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => state,
        () => state,
    );
}

export function setChatOpen(open: boolean) {
    try {
        localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
        // storage blocked: panel just won't be remembered
    }
    update({ open });
}

export const toggleChat = () => setChatOpen(!state.open);

export function setChatWidth(width: number) {
    const next = clampWidth(width);
    if (next === state.width) return;
    try {
        localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
        // storage blocked: width just won't be remembered
    }
    update({ width: next });
}

/** Stop streaming and decline any action still waiting for approval. */
export function stopChat() {
    abort?.abort();
    approvals.forEach((resolve) => resolve(false));
    approvals.clear();
}

// ------------------------------------------------------------ saved history

async function call<T>(
    method: string,
    url: string,
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        signal,
        headers: {
            Accept: 'application/json',
            ...(body === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
            ...csrfHeaders(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// One object per conversation being shown. A save that finishes after "new chat"
// resolves its server id through this object, so it cannot attach to the wrong chat.
let session: { id: number | null } = { id: null };
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
};

function flushSave() {
    clearTimeout(saveTimer);
    const first = state.messages.find((m) => m.kind === 'user');
    if (first?.kind !== 'user') return;
    const mine = session;
    const body = {
        title: first.text.slice(0, 60),
        summary,
        ui: state.messages.slice(-300),
        api: trimmedHistory(),
    };
    saving = saving.then(async () => {
        try {
            if (mine.id) {
                await call('PUT', `/assistant/conversations/${mine.id}`, body);
            } else {
                const created = await call<{ id: number }>(
                    'POST',
                    '/assistant/conversations',
                    body,
                );
                mine.id = created.id;
                if (session === mine) update({ conversationId: created.id });
            }
        } catch {
            // saving is a convenience; the chat itself keeps working
        }
    });
}

/** Empty chat. Never saves: callers flush first when the old one should be kept. */
function startFresh() {
    clearTimeout(saveTimer);
    session = { id: null };
    history = [];
    summary = '';
    update({ messages: [], busy: false, conversationId: null });
}

export function newChat() {
    stopChat();
    flushSave();
    startFresh();
}

export async function loadConversations() {
    try {
        update({
            conversations: await call<ConversationInfo[]>(
                'GET',
                '/assistant/conversations',
            ),
        });
    } catch {
        // list stays as it was
    }
}

export async function openConversation(id: number) {
    const saved = await call<{
        id: number;
        summary: string | null;
        ui: ChatMessage[];
        api: ApiMessage[];
    }>('GET', `/assistant/conversations/${id}`);
    stopChat();
    flushSave();
    session = { id: saved.id };
    history = repairApi(saved.api);
    summary = saved.summary ?? '';
    update({
        // Fresh ids: an aborted turn of the previous chat may still hold an old one.
        messages: repairCards(saved.ui).map((m) => ({ ...m, id: nextId++ })),
        busy: false,
        conversationId: saved.id,
    });
}

export async function deleteConversation(id: number) {
    await call('DELETE', `/assistant/conversations/${id}`);
    update({ conversations: state.conversations.filter((c) => c.id !== id) });
    if (state.conversationId === id) {
        stopChat();
        startFresh();
    }
}

let owner: number | null = null;

/**
 * Once per signed-in user: fetch their chat list and pick up the last chat when it
 * is recent. A different account in the same tab starts clean and nothing of the
 * previous account is saved under the new one.
 */
export async function bootstrapChat(userId: number) {
    if (owner === userId) return;
    const switched = owner !== null;
    owner = userId;
    if (switched) {
        stopChat();
        startFresh();
        update({ conversations: [] });
    }
    await loadConversations();
    const latest = state.conversations[0];
    if (
        latest &&
        !state.messages.length &&
        Date.now() - Date.parse(latest.updated_at) < RESUME_WITHIN_MS
    ) {
        try {
            await openConversation(latest.id);
        } catch {
            // start empty
        }
    }
}

// ------------------------------------------------------------ context size

let compactFailed = false;

/**
 * Keep the context the model receives small: clip old tool output, and once the
 * history is big summarize its oldest turns into `summary`. A failed summary is
 * not retried within the same message; the plain MAX_HISTORY trim still applies.
 */
async function compactIfNeeded(signal: AbortSignal) {
    history = shrinkOldResults(history);
    if (compactFailed || estimateChars(history) + summary.length < COMPACT_AT)
        return;
    const cut = pickCut(history, KEEP_RECENT);
    if (cut <= 0) return;

    const note = push({ kind: 'note', key: 'chat.compacting' });
    try {
        const res = await call<{ summary: string }>(
            'POST',
            '/assistant/compact',
            { summary, messages: history.slice(0, cut) },
            signal,
        );
        summary = res.summary;
        history = history.slice(cut);
        patch(note, { key: 'chat.compacted' });
    } catch {
        compactFailed = true;
        remove(note);
    }
}

export function answerApproval(id: number, approved: boolean) {
    approvals.get(id)?.(approved);
    approvals.delete(id);
}

// Trim only at user-message boundaries so no tool result loses its tool call.
function trimmedHistory(): ApiMessage[] {
    let start = 0;
    while (history.length - start > MAX_HISTORY) {
        const next = history.findIndex(
            (m, i) => i > start && m.role === 'user',
        );
        if (next === -1) break;
        start = next;
    }
    return history.slice(start);
}

/** One model turn over SSE; text goes to onToken, returns the finished message. */
async function streamTurn(
    signal: AbortSignal,
    onToken: (token: string) => void,
): Promise<ApiMessage> {
    const res = await fetch('/assistant/chat', {
        method: 'POST',
        credentials: 'same-origin',
        signal,
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...csrfHeaders(),
        },
        body: JSON.stringify({
            messages: trimmedHistory(),
            tools: assistantTools,
            summary,
            page: {
                url: location.pathname + location.search,
                title: document.title,
            },
        }),
    });

    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
        const json = await res.json().catch(() => null);
        throw new Error(
            res.status === 419
                ? 'Sesi kedaluwarsa. Muat ulang halaman.'
                : res.status === 429
                  ? 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.'
                  : (json?.message ?? `Permintaan gagal (HTTP ${res.status}).`),
        );
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply: ApiMessage | null = null;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let event;
            try {
                event = JSON.parse(line.slice(5).trim());
            } catch {
                continue; // [DONE] or a broken line
            }
            if (typeof event.token === 'string') onToken(event.token);
            else if (event.assistant) reply = event.assistant;
            else if (event.error)
                throw new Error(
                    event.error.message ?? 'Asisten gagal menjawab.',
                );
        }
    }
    if (!reply) throw new Error('Koneksi terputus sebelum jawaban selesai.');
    return reply;
}

function rememberLoggerNames(result: CommandResult) {
    const data = result.data as {
        loggers?: { id: string; name: string }[];
        logger?: { id: string; name: string };
    };
    for (const logger of [...(data?.loggers ?? []), data?.logger]) {
        if (logger?.id) loggerNames.set(logger.id, logger.name);
    }
}

/** Run one tool call (after approval if it changes something); returns the tool result text. */
async function runToolCall(call: ToolCall): Promise<string> {
    const name = call.function.name;
    let input: Record<string, unknown>;
    try {
        input = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
    } catch {
        return JSON.stringify({
            ok: false,
            message: 'Argumen tool bukan JSON yang valid.',
        });
    }

    // A call that doesn't match its schema (unknown tool, missing or extra
    // argument) goes straight back to the model, which retries on its own;
    // the user only ever sees calls that can actually run.
    const problem = inputProblem(name, input);
    if (problem) return JSON.stringify({ ok: false, message: problem });

    const risk = commandRisk(name) ?? 'read';
    const ask = needsConfirmation(risk);
    const id = push({
        kind: 'tool',
        name,
        input,
        risk,
        status: ask ? 'awaiting' : 'running',
        loggerName: loggerNames.get(String(input.logger_id)),
    });

    if (ask) {
        const approved = await new Promise<boolean>((resolve) =>
            approvals.set(id, resolve),
        );
        if (!approved) {
            patch(id, { status: 'denied' });
            return JSON.stringify({
                ok: false,
                message: 'Pengguna membatalkan aksi ini.',
            });
        }
        patch(id, { status: 'running' });
    }

    const result = await runAssistantCommand(name, input);
    rememberLoggerNames(result);
    patch(id, {
        status: result.ok ? 'done' : 'failed',
        result: result.message,
        view: result.view,
    });
    const text = JSON.stringify({ ...result, view: undefined });
    return text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}…(dipotong)`
        : text;
}

export async function sendMessage(text: string) {
    const value = text.trim();
    if (!value || state.busy) return;

    push({ kind: 'user', text: value });
    history.push({ role: 'user', content: value });
    compactFailed = false;
    const controller = (abort = new AbortController());
    update({ busy: true });
    let bubble = 0;

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            await compactIfNeeded(controller.signal);
            let reply = '';
            bubble = push({ kind: 'assistant', text: '' });
            const message = await streamTurn(controller.signal, (token) => {
                reply += token;
                patch(bubble, { text: reply });
            });
            if (message.content) patch(bubble, { text: message.content });
            else remove(bubble);
            history.push(message);
            scheduleSave();
            if (!message.tool_calls?.length) return;

            // Every tool call needs a result in the history, even when stopped.
            for (const call of message.tool_calls) {
                const content = controller.signal.aborted
                    ? JSON.stringify({
                          ok: false,
                          message: 'Dihentikan pengguna.',
                      })
                    : await runToolCall(call);
                history.push({ role: 'tool', tool_call_id: call.id, content });
            }
            if (controller.signal.aborted) return;
        }
        push({
            kind: 'assistant',
            text: '',
            error: 'Asisten berhenti setelah terlalu banyak langkah. Coba persempit permintaannya.',
        });
    } catch (error) {
        if (controller.signal.aborted) {
            const last = state.messages.find((m) => m.id === bubble);
            if (last?.kind === 'assistant' && !last.text) remove(bubble);
        } else {
            const message =
                error instanceof Error ? error.message : String(error);
            if (state.messages.some((m) => m.id === bubble))
                patch(bubble, { error: message });
            else push({ kind: 'assistant', text: '', error: message });
        }
    } finally {
        if (abort === controller) abort = null;
        update({ busy: false });
        scheduleSave();
    }
}
