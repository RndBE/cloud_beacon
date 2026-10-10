/**
 * Assistant chat state and tool loop. POST /assistant/chat (AssistantController)
 * streams one model turn; when the model asks for tools, they run here in the
 * browser via runAssistantCommand (changes wait for the user's click), and the
 * results go back in the next turn. Module-level so the conversation survives
 * Inertia page visits (pages wrap themselves in AppLayout, which remounts).
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
};
export type ChatMessage =
    | { id: number; kind: 'user'; text: string }
    | { id: number; kind: 'assistant'; text: string; error?: string }
    | ToolMessage;

type ToolCall = {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
};
type ApiMessage = {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    reasoning_content?: string;
};
type ChatState = { open: boolean; busy: boolean; messages: ChatMessage[] };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

const STORAGE_KEY = 'cloud-beacon.chat-open';
const MAX_ROUNDS = 10; // model turns per user message
const MAX_HISTORY = 60; // messages sent per request
const MAX_RESULT_CHARS = 12000;

function readOpen(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

let state: ChatState = { open: readOpen(), busy: false, messages: [] };
let nextId = 1;
let history: ApiMessage[] = [];
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

/** Stop streaming and decline any action still waiting for approval. */
export function stopChat() {
    abort?.abort();
    approvals.forEach((resolve) => resolve(false));
    approvals.clear();
}

export function newChat() {
    stopChat();
    history = [];
    update({ messages: [], busy: false });
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

    // Unknown names never execute (runAssistantCommand rejects them), so no approval needed.
    const risk = commandRisk(name) ?? 'read';
    const problem = inputProblem(name, input);
    if (problem) {
        push({
            kind: 'tool',
            name,
            input,
            risk,
            status: 'failed',
            result: problem,
        });
        return JSON.stringify({ ok: false, message: problem });
    }
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
    });
    const text = JSON.stringify(result);
    return text.length > MAX_RESULT_CHARS
        ? `${text.slice(0, MAX_RESULT_CHARS)}…(dipotong)`
        : text;
}

export async function sendMessage(text: string) {
    const value = text.trim();
    if (!value || state.busy) return;

    push({ kind: 'user', text: value });
    history.push({ role: 'user', content: value });
    const controller = (abort = new AbortController());
    update({ busy: true });
    let bubble = 0;

    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            let reply = '';
            bubble = push({ kind: 'assistant', text: '' });
            const message = await streamTurn(controller.signal, (token) => {
                reply += token;
                patch(bubble, { text: reply });
            });
            if (!message.content) remove(bubble);
            history.push(message);
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
    }
}
