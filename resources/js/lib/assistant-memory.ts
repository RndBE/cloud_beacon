/**
 * Pure helpers that keep the assistant's model context small and valid:
 * shrinking old tool output, choosing what to summarize, and repairing a saved
 * history that was cut off mid tool loop. Used by lib/assistant-chat.ts.
 */
export type ToolCall = {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
};
export type ApiMessage = {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    reasoning_content?: string;
};

const STOPPED = JSON.stringify({
    ok: false,
    message: 'Dihentikan: halaman dimuat ulang.',
});

export const estimateChars = (messages: ApiMessage[]) =>
    messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);

/**
 * Tool results from before the latest user message are the bulk of the tokens
 * (a get_logger result runs to thousands of characters) and the model can just
 * call the tool again, so keep only their start.
 */
export function shrinkOldResults(
    messages: ApiMessage[],
    keep = 800,
): ApiMessage[] {
    let lastUser = -1;
    messages.forEach((m, i) => {
        if (m.role === 'user') lastUser = i;
    });
    return messages.map((m, i) =>
        i < lastUser && m.role === 'tool' && m.content.length > keep
            ? {
                  ...m,
                  content: `${m.content.slice(0, keep)}…(dipotong; panggil ulang tool bila perlu)`,
              }
            : m,
    );
}

/**
 * Where to cut: messages before the returned index get summarized, the rest stay.
 * Always a user message, so no tool result is separated from its tool call. The
 * kept tail is the longest one within `keepChars`, or just the latest turn when
 * even that is bigger. 0 = nothing can be dropped safely.
 */
export function pickCut(messages: ApiMessage[], keepChars: number): number {
    let cut = 0;
    let tail = 0;
    for (let i = messages.length - 1; i >= 1; i--) {
        tail += JSON.stringify(messages[i]).length;
        if (messages[i].role !== 'user') continue;
        if (tail <= keepChars) cut = i;
        else {
            if (!cut) cut = i;
            break;
        }
    }
    return cut;
}

/**
 * A saved history can stop in the middle of a tool loop (tab closed while a
 * card waited for approval). Providers reject a tool call without a result, so
 * give each one an answer and drop results that lost their call.
 */
export function repairApi(messages: ApiMessage[]): ApiMessage[] {
    const out: ApiMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'tool') continue; // orphan: its call was not just before it
        out.push(m);
        if (m.role !== 'assistant' || !m.tool_calls?.length) continue;

        const wanted = new Set(m.tool_calls.map((call) => call.id));
        const answered = new Set<string>();
        let j = i + 1;
        for (; j < messages.length && messages[j].role === 'tool'; j++) {
            const id = messages[j].tool_call_id ?? '';
            if (wanted.has(id) && !answered.has(id)) {
                answered.add(id);
                out.push(messages[j]);
            }
        }
        for (const call of m.tool_calls)
            if (!answered.has(call.id))
                out.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: STOPPED,
                });
        i = j - 1;
    }
    return out;
}

/** Cards that were waiting or running when the page went away can never finish. */
export function repairCards<T extends { kind: string; status?: string }>(
    cards: T[],
): T[] {
    return cards.map((c) =>
        c.kind === 'tool' && (c.status === 'awaiting' || c.status === 'running')
            ? { ...c, status: 'denied' }
            : c,
    );
}
