import { usePage } from '@inertiajs/react';
import {
    ArrowUp,
    Ban,
    Check,
    History,
    Loader2,
    ShieldAlert,
    Sparkles,
    Square,
    SquarePen,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { WiringDiagram } from '@/components/wiring-diagram';
import { useIsMobile } from '@/hooks/use-mobile';
import {
    answerApproval,
    CHAT_DEFAULT_WIDTH,
    CHAT_MAX_WIDTH,
    CHAT_MIN_WIDTH,
    bootstrapChat,
    deleteConversation,
    loadConversations,
    newChat,
    openConversation,
    sendMessage,
    setChatOpen,
    setChatWidth,
    stopChat,
    toggleChat,
    useChatState,
} from '@/lib/assistant-chat';
import type { ConversationInfo, ToolMessage } from '@/lib/assistant-chat';
import type { Connected, WiringSpec } from '@/lib/logger-wiring';
import { cn } from '@/lib/utils';

export function ChatToggle() {
    const { t } = useTranslation();
    const { open } = useChatState();

    return (
        <Button
            variant={open ? 'secondary' : 'ghost'}
            size="sm"
            className="ml-auto"
            aria-pressed={open}
            aria-label={t('chat.title')}
            onClick={toggleChat}
        >
            <Sparkles />
            <span className="hidden sm:inline">{t('chat.title')}</span>
        </Button>
    );
}

const TOOL_ICON = {
    awaiting: <ShieldAlert className="size-3.5 text-amber-500" />,
    running: (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
    ),
    done: <Check className="size-3.5 text-emerald-500" />,
    failed: <X className="size-3.5 text-destructive" />,
    denied: <Ban className="size-3.5 text-muted-foreground" />,
};

function ToolCard({ message }: { message: ToolMessage }) {
    const { t } = useTranslation();
    // The wiring picture replaces the raw arguments: they are its source.
    const diagram =
        message.name === 'show_wiring_diagram' && message.status === 'done'
            ? (message.input as WiringSpec)
            : null;
    const args = Object.entries(message.input)
        .filter(([key]) => key !== 'logger_id')
        .map(
            ([key, value]) =>
                `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
        )
        .join(', ');

    return (
        <div
            className={cn(
                'rounded-lg border px-3 py-2 text-xs',
                message.status === 'awaiting' &&
                    (message.risk === 'destructive'
                        ? 'border-destructive/50'
                        : 'border-amber-500/50'),
            )}
        >
            <div className="flex items-center gap-2">
                {TOOL_ICON[message.status]}
                <span className="font-medium">
                    {message.name.replace(/_/g, ' ')}
                </span>
                {message.loggerName && (
                    <span className="truncate text-muted-foreground">
                        · {message.loggerName}
                    </span>
                )}
            </div>
            {diagram && (
                <WiringDiagram
                    spec={diagram}
                    connected={
                        (
                            message.view as
                                | { connected?: Connected[] }
                                | undefined
                        )?.connected
                    }
                />
            )}
            {!diagram && args && (
                <p className="mt-1 line-clamp-3 break-words text-muted-foreground">
                    {args}
                </p>
            )}
            {!diagram && message.result && (
                <p
                    className={cn(
                        'mt-1 break-words',
                        message.status === 'failed' && 'text-destructive',
                    )}
                >
                    {message.result}
                </p>
            )}
            {message.status === 'denied' && (
                <p className="mt-1 text-muted-foreground">
                    {t('chat.cancelled')}
                </p>
            )}
            {message.status === 'awaiting' && (
                <div className="mt-2 flex items-center gap-2">
                    <span className="mr-auto text-muted-foreground">
                        {t('chat.needs_approval')}
                    </span>
                    <Button
                        size="xs"
                        variant="outline"
                        onClick={() => answerApproval(message.id, false)}
                    >
                        {t('chat.deny')}
                    </Button>
                    <Button
                        size="xs"
                        variant={
                            message.risk === 'destructive'
                                ? 'destructive'
                                : 'default'
                        }
                        onClick={() => answerApproval(message.id, true)}
                    >
                        {t('chat.approve')}
                    </Button>
                </div>
            )}
        </div>
    );
}

function HistoryList({
    items,
    activeId,
    onOpen,
}: {
    items: ConversationInfo[];
    activeId: number | null;
    onOpen: () => void;
}) {
    const { t, i18n } = useTranslation();
    if (!items.length)
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                {t('chat.history_empty')}
            </p>
        );
    return (
        <ul className="flex flex-col gap-1">
            {items.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                    <button
                        type="button"
                        className={cn(
                            'flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted',
                            c.id === activeId && 'bg-muted',
                        )}
                        onClick={() => {
                            void openConversation(c.id).then(onOpen);
                        }}
                    >
                        <span className="truncate text-sm">
                            {c.title || t('chat.untitled')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {new Date(c.updated_at).toLocaleString(
                                i18n.language,
                                {
                                    day: 'numeric',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                },
                            )}
                        </span>
                    </button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 opacity-60 hover:opacity-100"
                        aria-label={t('chat.delete')}
                        title={t('chat.delete')}
                        onClick={() => void deleteConversation(c.id)}
                    >
                        <Trash2 />
                    </Button>
                </li>
            ))}
        </ul>
    );
}

function ChatBody() {
    const { t } = useTranslation();
    const { messages, busy, conversations, conversationId } = useChatState();
    const [draft, setDraft] = useState('');
    const [showHistory, setShowHistory] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const last = messages.at(-1);
    const thinking =
        busy &&
        !(last?.kind === 'assistant' && last.text) &&
        !(
            last?.kind === 'tool' &&
            ['awaiting', 'running'].includes(last.status)
        );

    useEffect(() => {
        listRef.current?.scrollTo({
            top: listRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [messages, thinking]);

    function submit(text: string) {
        if (!text.trim() || busy) return;
        setShowHistory(false);
        void sendMessage(text);
        setDraft('');
    }

    function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(draft);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2 border-b px-3 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                <Sparkles className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t('chat.title')}</span>
                <div className="ml-auto flex items-center gap-1">
                    <Button
                        variant={showHistory ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-pressed={showHistory}
                        aria-label={t('chat.history')}
                        title={t('chat.history')}
                        onClick={() => {
                            if (!showHistory) void loadConversations();
                            setShowHistory(!showHistory);
                        }}
                    >
                        <History />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={messages.length === 0}
                        aria-label={t('chat.new_chat')}
                        title={t('chat.new_chat')}
                        onClick={() => {
                            newChat();
                            setShowHistory(false);
                        }}
                    >
                        <SquarePen />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('chat.close')}
                        title={t('chat.close')}
                        onClick={() => setChatOpen(false)}
                    >
                        <X />
                    </Button>
                </div>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
                {showHistory ? (
                    <HistoryList
                        items={conversations}
                        activeId={conversationId}
                        onOpen={() => setShowHistory(false)}
                    />
                ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                        <Sparkles className="size-6 text-muted-foreground" />
                        <p className="font-medium">{t('chat.empty_title')}</p>
                        <p className="mb-2 text-sm text-muted-foreground">
                            {t('chat.empty_hint')}
                        </p>
                        {[1, 2, 3].map((n) => (
                            <Button
                                key={n}
                                variant="outline"
                                size="sm"
                                className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                                onClick={() =>
                                    submit(t(`chat.suggestion_${n}`))
                                }
                            >
                                {t(`chat.suggestion_${n}`)}
                            </Button>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {messages.map((message) =>
                            message.kind === 'tool' ? (
                                <ToolCard key={message.id} message={message} />
                            ) : message.kind === 'note' ? (
                                <p
                                    key={message.id}
                                    className="text-center text-xs text-muted-foreground"
                                >
                                    {t(message.key)}
                                </p>
                            ) : (
                                <div
                                    key={message.id}
                                    className={cn(
                                        'text-sm break-words whitespace-pre-wrap',
                                        message.kind === 'user' &&
                                            'max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2',
                                    )}
                                >
                                    {message.text}
                                    {message.kind === 'assistant' &&
                                        message.error && (
                                            <p className="text-destructive">
                                                {message.error}
                                            </p>
                                        )}
                                </div>
                            ),
                        )}
                        {thinking && (
                            <div
                                role="status"
                                aria-label={t('chat.thinking')}
                                className="flex gap-1 py-2"
                            >
                                {['-0.3s', '-0.15s', '0s'].map((delay) => (
                                    <span
                                        key={delay}
                                        style={{ animationDelay: delay }}
                                        className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <form
                className="shrink-0 p-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    submit(draft);
                }}
            >
                <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                    <Textarea
                        rows={1}
                        value={draft}
                        placeholder={t('chat.placeholder')}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-1.5 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    />
                    {busy ? (
                        <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="rounded-full"
                            aria-label={t('chat.stop')}
                            title={t('chat.stop')}
                            onClick={stopChat}
                        >
                            <Square className="fill-current" />
                        </Button>
                    ) : (
                        <Button
                            type="submit"
                            size="icon"
                            className="rounded-full"
                            disabled={!draft.trim()}
                            aria-label={t('chat.send')}
                        >
                            <ArrowUp />
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
}

/** Left edge of the docked panel: drag to resize, arrow keys to nudge, double-click to reset. */
function ResizeHandle({
    width,
    onDragging,
}: {
    width: number;
    onDragging: (dragging: boolean) => void;
}) {
    const { t } = useTranslation();
    const start = useRef<{ x: number; width: number } | null>(null);

    function onPointerDown(e: PointerEvent<HTMLDivElement>) {
        e.preventDefault(); // no text selection while dragging
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        onDragging(true);
    }

    function onPointerMove(e: PointerEvent<HTMLDivElement>) {
        if (!start.current) return;
        // The panel grows to the left, so moving the pointer left widens it.
        setChatWidth(start.current.width + (start.current.x - e.clientX));
    }

    function onPointerUp() {
        start.current = null;
        onDragging(false);
    }

    function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        const step = e.shiftKey ? 96 : 24;
        if (e.key === 'ArrowLeft') setChatWidth(width + step);
        else if (e.key === 'ArrowRight') setChatWidth(width - step);
        else if (e.key === 'Home') setChatWidth(CHAT_DEFAULT_WIDTH);
        else return;
        e.preventDefault();
    }

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('chat.resize')}
            aria-valuemin={CHAT_MIN_WIDTH}
            aria-valuemax={CHAT_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            title={t('chat.resize')}
            className="group absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => setChatWidth(CHAT_DEFAULT_WIDTH)}
            onKeyDown={onKeyDown}
        >
            <span className="my-auto h-12 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
        </div>
    );
}

export function ChatPanel() {
    const { t } = useTranslation();
    const isMobile = useIsMobile();
    const { open, width } = useChatState();
    const [dragging, setDragging] = useState(false);
    const { auth } = usePage<{ auth: { user?: { id: number } | null } }>()
        .props;
    const userId = auth?.user?.id;

    // Pick up this user's saved chats once per sign-in (the store outlives page visits).
    useEffect(() => {
        if (userId) void bootstrapChat(userId);
    }, [userId]);

    if (isMobile) {
        return (
            <Sheet open={open} onOpenChange={setChatOpen}>
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="w-full gap-0 p-0 sm:max-w-md"
                >
                    <SheetTitle className="sr-only">
                        {t('chat.title')}
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        {t('chat.empty_hint')}
                    </SheetDescription>
                    <ChatBody />
                </SheetContent>
            </Sheet>
        );
    }

    // Docked next to the inset content (like the left sidebar); fixed-width
    // inner box so the contents don't reflow while the width animates.
    return (
        <aside
            aria-label={t('chat.title')}
            inert={!open}
            style={{ width: open ? width : 0, maxWidth: '70vw' }}
            className={cn(
                'sticky top-0 h-svh shrink-0 overflow-hidden',
                // Following the pointer must not lag behind a width animation.
                !dragging && 'transition-[width] duration-200 ease-linear',
            )}
        >
            <ResizeHandle width={width} onDragging={setDragging} />
            <div
                style={{ width, maxWidth: '70vw' }}
                className="flex h-full py-2 pr-2"
            >
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-sm">
                    <ChatBody />
                </div>
            </div>
        </aside>
    );
}
