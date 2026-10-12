import { Maximize2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { BOARDS, WIRE_COLORS, terminalOf } from '@/lib/logger-wiring';
import type { Connected, Terminal, WiringSpec } from '@/lib/logger-wiring';
import { cn } from '@/lib/utils';

const GAP = 6; // between wire lanes
const DEPTH = 8; // cabinet thickness drawn on the top and right
const RADIUS = 8; // corner radius of the cabinet

/**
 * Outline of the rounded front plus its depth: the hull of the front and the
 * same shape shifted up-right, so the back follows the rounded corners and
 * nothing is left unconnected.
 */
function cabinetPath(x: number, y: number, w: number, h: number): string {
    const r = RADIUS;
    const d = DEPTH;
    const a = r * Math.SQRT1_2; // tangent point of a 45deg edge on a corner arc
    const arc = `A${r},${r} 0 0 1`;

    return [
        `M${x + r - a},${y + r - a}`,
        `L${x + r - a + d},${y + r - a - d}`,
        `${arc} ${x + d + r},${y - d}`,
        `H${x + d + w - r}`,
        `${arc} ${x + d + w},${y - d + r}`,
        `V${y - d + h - r}`,
        `${arc} ${x + d + w - r + a},${y - d + h - r + a}`,
        `L${x + w - r + a},${y + h - r + a}`,
        `${arc} ${x + w - r},${y + h}`,
        `H${x + r}`,
        `${arc} ${x},${y + h - r}`,
        `V${y + r}`,
        `${arc} ${x + r - a},${y + r - a}`,
        'Z',
    ].join(' ');
}
const BOX_H = 56;
const PANEL = '#f3f4f6';
const INK = '#111827';
const SENSOR_ON = '#16a34a'; // terminal already carries a registered sensor

type Placed = {
    n: number; // 1-based, the order the assistant listed them in
    from: string;
    color: string;
    t: Terminal;
    path: string;
    stub: { x: number; y: number };
    end: { x: number; y: number }; // where the badge sits on the terminal side
};

/**
 * Orthogonal routing from a sensor box under the panel to each terminal.
 * Wires are ordered so the lanes of a side never cross (leftmost stub goes to
 * the highest terminal on the left, mirrored on the right); the bottom row
 * puts the longest horizontal runs on the highest lanes.
 */
function layout(spec: WiringSpec) {
    const b = BOARDS[spec.board];
    const items = (spec.wires ?? []).flatMap((w, i) => {
        const t = terminalOf(spec.board, w.to);
        return t ? [{ w, n: i + 1, t }] : [];
    });
    const left = items
        .filter((x) => x.t.side === 'left')
        .sort((p, q) => p.t.cy - q.t.cy);
    const bottom = items
        .filter((x) => x.t.side === 'bottom')
        .sort((p, q) => p.t.cx - q.t.cx);
    const right = items
        .filter((x) => x.t.side === 'right')
        .sort((p, q) => q.t.cy - p.t.cy);
    const ordered = [...left, ...bottom, ...right];

    // Neighbouring bottom terminals sit closer than a badge is wide: drop every
    // second badge of a close pair a little lower.
    const lowered = new Set<(typeof bottom)[number]>();
    bottom.forEach((x, j) => {
        const prev = bottom[j - 1];
        if (prev && x.t.cx - prev.t.cx < 16 && !lowered.has(prev))
            lowered.add(x);
    });
    const hasWires = ordered.length > 0;
    const count = Math.max(ordered.length, 1);

    const bodyRight = b.body.x + b.body.w;
    const bodyBottom = b.body.y + b.body.h;
    const baseY = bodyBottom + 8 + (count - 1) * GAP;
    const boxTop = baseY + 12;
    const boxW = Math.max(150, count * 46);
    const boxX = b.body.x + b.body.w / 2 - boxW / 2;
    const slot = boxW / count;
    const stubX = (k: number) => boxX + (k + 0.5) * slot;

    // Longest horizontal runs first on the bottom lanes.
    const rank = new Map(
        bottom
            .map((x, j) => ({
                x,
                run: Math.abs(x.t.cx - stubX(left.length + j)),
            }))
            .sort((p, q) => q.run - p.run)
            .map((e, r) => [e.x, r]),
    );

    const placed: Placed[] = ordered.map((x, k) => {
        const { t } = x;
        const sx = stubX(k);
        let laneY: number;
        let path: string;
        let end: { x: number; y: number };
        if (t.side === 'left') {
            const j = left.indexOf(x);
            laneY = baseY - j * GAP;
            const laneX = b.body.x - 10 - (left.length - 1 - j) * GAP;
            const edge = t.cx - (t.round ? t.h : t.w) / 2;
            path = `M${sx},${boxTop} V${laneY} H${laneX} V${t.cy} H${edge}`;
            end = { x: laneX, y: t.cy };
        } else if (t.side === 'right') {
            const j = right.indexOf(x);
            laneY =
                baseY -
                (left.length + bottom.length + (right.length - 1 - j)) * GAP;
            const laneX = bodyRight + DEPTH + 8 + j * GAP;
            const edge = t.cx + (t.round ? t.h : t.w) / 2;
            path = `M${sx},${boxTop} V${laneY} H${laneX} V${t.cy} H${edge}`;
            end = { x: laneX, y: t.cy };
        } else {
            laneY =
                baseY -
                (left.length + (bottom.length - 1 - (rank.get(x) ?? 0))) * GAP;
            const edge = t.cy + t.h / 2;
            path = `M${sx},${boxTop} V${laneY} H${t.cx} V${edge}`;
            end = { x: t.cx, y: edge + 9 + (lowered.has(x) ? 12 : 0) };
        }
        return {
            n: x.n,
            from: x.w.from,
            color: WIRE_COLORS[x.w.color] ?? WIRE_COLORS.blue,
            t,
            path,
            stub: { x: sx, y: boxTop },
            end,
        };
    });

    const xMin = hasWires
        ? Math.min(
              b.body.x,
              boxX,
              b.body.x - 10 - Math.max(left.length - 1, 0) * GAP - 8,
          )
        : b.body.x;
    const xMax = hasWires
        ? Math.max(
              bodyRight + DEPTH,
              boxX + boxW,
              bodyRight + DEPTH + 8 + right.length * GAP + 8,
          )
        : bodyRight + DEPTH;
    const yMin = b.body.y - DEPTH;
    const yMax = hasWires ? boxTop + BOX_H : bodyBottom;
    return {
        board: b,
        placed,
        hasWires,
        boxX,
        boxW,
        boxTop,
        view: [xMin - 6, yMin - 4, xMax - xMin + 12, yMax - yMin + 10] as const,
    };
}

const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

function Panel({
    spec,
    connected,
    className,
}: {
    spec: WiringSpec;
    connected?: Connected[];
    className?: string;
}) {
    const {
        board: b,
        placed,
        hasWires,
        boxX,
        boxW,
        boxTop,
        view,
    } = useMemo(() => layout(spec), [spec]);
    const { x, y, w, h } = b.body;
    const active = new Map(placed.map((p) => [p.t.id, p]));
    const used = new Set((connected ?? []).map((c) => c.terminal));

    return (
        <svg
            viewBox={view.join(' ')}
            role="img"
            aria-label={b.nama}
            className={cn('h-auto w-full', className)}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
            {/* cabinet: rounded depth behind, then the rounded front */}
            <path d={cabinetPath(x, y, w, h)} fill="#d9dde3" stroke="#9ca3af" />
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={RADIUS}
                fill={PANEL}
                stroke="#9ca3af"
            />

            <text
                x={b.title.x}
                y={b.title.y}
                fontSize={b.title.size}
                fontWeight={800}
                fill={INK}
                textLength={b.title.w}
                lengthAdjust="spacingAndGlyphs"
            >
                {b.title.text}
            </text>
            <text
                x={b.model.x}
                y={b.model.y}
                fontSize={8}
                fontWeight={700}
                fill={INK}
            >
                {b.model.text}
            </text>
            <rect
                x={b.display.x}
                y={b.display.y}
                width={b.display.w}
                height={b.display.h}
                rx={6}
                fill="#d9f99d"
                stroke="#374151"
                strokeWidth={1.2}
            />

            {b.ports.map((p) =>
                p.w ? (
                    <g key={p.text}>
                        <rect
                            x={p.cx - p.w / 2}
                            y={p.cy - (p.h ?? 12) / 2}
                            width={p.w}
                            height={p.h ?? 12}
                            fill="#fff"
                            stroke="#374151"
                            strokeWidth={0.8}
                        />
                        <text
                            x={p.cx}
                            y={p.cy}
                            fontSize={Math.min(8, p.w * 0.4)}
                            fontWeight={700}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={INK}
                        >
                            {p.text}
                        </text>
                    </g>
                ) : (
                    <text
                        key={p.text}
                        x={p.cx}
                        y={p.cy}
                        fontSize={7.5}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#4b5563"
                    >
                        {p.text}
                    </text>
                ),
            )}

            {b.terminals.map((t) => {
                const on = active.get(t.id);
                const fs = Math.min(8, t.h * 0.55, t.w * 0.55);
                const fill =
                    t.tone === 'redfill'
                        ? '#b91c1c'
                        : t.tone === 'dark'
                          ? INK
                          : '#fff';
                const ink =
                    t.tone === 'redfill' || t.tone === 'dark'
                        ? '#fff'
                        : t.tone === 'red'
                          ? '#dc2626'
                          : INK;
                const taken = used.has(t.id);
                const mark = on?.color ?? (taken ? SENSOR_ON : null);
                const common = {
                    fill: mark ?? fill,
                    fillOpacity: mark ? 0.3 : 1,
                    stroke: mark ?? INK,
                    strokeWidth: on ? 2.4 : taken ? 1.8 : 0.8,
                };
                return (
                    <g key={t.id}>
                        {t.round ? (
                            <circle
                                cx={t.cx}
                                cy={t.cy}
                                r={t.h / 2}
                                {...common}
                            />
                        ) : (
                            <rect
                                x={t.cx - t.w / 2}
                                y={t.cy - t.h / 2}
                                width={t.w}
                                height={t.h}
                                {...common}
                            />
                        )}
                        <text
                            x={t.cx}
                            y={t.cy}
                            fontSize={fs}
                            fontWeight={700}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill={ink}
                        >
                            {t.label === '-' ? '−' : t.label}
                        </text>
                        {taken && (
                            <circle
                                cx={t.cx + t.w / 2}
                                cy={t.cy - t.h / 2}
                                r={2.8}
                                fill={SENSOR_ON}
                                stroke="#fff"
                                strokeWidth={0.8}
                            />
                        )}
                    </g>
                );
            })}

            {hasWires && (
                <>
                    <rect
                        x={boxX}
                        y={boxTop}
                        width={boxW}
                        height={BOX_H}
                        rx={6}
                        className="fill-card stroke-border"
                    />
                    <text
                        x={boxX + boxW / 2}
                        y={boxTop + BOX_H - 8}
                        fontSize={8.5}
                        fontWeight={600}
                        textAnchor="middle"
                        className="fill-foreground"
                    >
                        {clip(spec.sensor ?? '', Math.floor(boxW / 5))}
                    </text>
                </>
            )}

            {placed.map((p) => (
                <g key={p.n}>
                    <path
                        d={p.path}
                        fill="none"
                        stroke="#fff"
                        strokeOpacity={0.85}
                        strokeWidth={4.8}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                    <path
                        d={p.path}
                        fill="none"
                        stroke={p.color}
                        strokeWidth={2.4}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />
                    {[{ x: p.stub.x, y: p.stub.y + 12 }, p.end].map((at, i) => (
                        <g key={i}>
                            <circle
                                cx={at.x}
                                cy={at.y}
                                r={5.5}
                                fill={p.color}
                                stroke="#fff"
                                strokeWidth={1}
                            />
                            <text
                                x={at.x}
                                y={at.y}
                                fontSize={7.5}
                                fontWeight={700}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="#fff"
                            >
                                {p.n}
                            </text>
                        </g>
                    ))}
                    <text
                        x={p.stub.x}
                        y={p.stub.y + 30}
                        fontSize={7}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                    >
                        {clip(p.from, 11)}
                    </text>
                </g>
            ))}
        </svg>
    );
}

function Legend({
    spec,
    connected,
}: {
    spec: WiringSpec;
    connected?: Connected[];
}) {
    const { t } = useTranslation();
    const rows = (spec.wires ?? []).flatMap((w, i) => {
        const term = terminalOf(spec.board, w.to);
        return term ? [{ n: i + 1, w, term }] : [];
    });
    if (!rows.length && !connected) return null;
    const taken = new Map(
        (connected ?? []).map((c) => [c.terminal, c.sensors]),
    );
    const printed = (id: string) => {
        const label = terminalOf(spec.board, id)?.label ?? id;
        return label === '-' ? '−' : label;
    };

    return (
        <div className="flex flex-col gap-2">
            {rows.length > 0 && (
                <ol className="flex flex-col gap-1 text-xs">
                    {rows.map(({ n, w, term }) => (
                        <li key={n} className="flex items-start gap-1.5">
                            <span
                                style={{ background: WIRE_COLORS[w.color] }}
                                className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                            >
                                {n}
                            </span>
                            <span className="min-w-0 break-words">
                                {w.from} → <b>{printed(term.id)}</b>{' '}
                                <span className="text-muted-foreground">
                                    {term.use}
                                </span>
                                {taken.has(term.id) && (
                                    <span className="text-amber-600 dark:text-amber-400">
                                        {' '}
                                        ({t('chat.wiring_in_use')}:{' '}
                                        {taken.get(term.id)!.join(', ')})
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {connected && (
                <div className="flex flex-col gap-1 text-xs">
                    <p className="font-medium">{t('chat.wiring_connected')}</p>
                    {connected.length ? (
                        <ul className="flex flex-col gap-0.5">
                            {connected.map((c) => (
                                <li
                                    key={c.terminal}
                                    className="flex items-start gap-1.5"
                                >
                                    <span
                                        style={{ background: SENSOR_ON }}
                                        className="mt-1 size-2 shrink-0 rounded-full"
                                    />
                                    <span className="min-w-0 break-words">
                                        <b>{printed(c.terminal)}</b> ·{' '}
                                        {c.sensors.join(', ')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-muted-foreground">
                            {t('chat.wiring_connected_none')}
                        </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                        {t('chat.wiring_key')}
                    </p>
                </div>
            )}
        </div>
    );
}

export function WiringDiagram({
    spec,
    connected,
}: {
    spec: WiringSpec;
    connected?: Connected[];
}) {
    const { t } = useTranslation();
    const [zoom, setZoom] = useState(false);
    const title = t('chat.wiring_title', { board: BOARDS[spec.board].nama });
    const note = t(
        spec.wires?.length ? 'chat.wiring_note' : 'chat.wiring_overview',
    );

    return (
        <div className="mt-2 flex flex-col gap-2">
            <div className="relative overflow-hidden rounded-md border bg-background p-1">
                <Panel spec={spec} connected={connected} />
                <Button
                    variant="secondary"
                    size="icon-sm"
                    className="absolute top-1 right-1"
                    aria-label={t('chat.wiring_zoom')}
                    title={t('chat.wiring_zoom')}
                    onClick={() => setZoom(true)}
                >
                    <Maximize2 />
                </Button>
            </div>
            <Legend spec={spec} connected={connected} />
            <p className="text-[11px] text-muted-foreground">{note}</p>

            <Dialog open={zoom} onOpenChange={setZoom}>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{note}</DialogDescription>
                    <Panel
                        spec={spec}
                        connected={connected}
                        className="max-h-[62vh]"
                    />
                    <Legend spec={spec} connected={connected} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
