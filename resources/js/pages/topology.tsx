import { Head, Link } from '@inertiajs/react';
import { Cable, Globe, Minus, Maximize, Plus, Radio, Signal, Wifi } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface TopologyLogger {
    id: number;
    name: string;
    serialNumber: string;
    location: string;
    status: 'online' | 'offline' | 'warning';
    connectionType: string;
    firmwareVersion: string;
    model: string;
    modelImage: string | null;
    signalStrength: number;
    sensorsCount: number;
}

interface TopologyProps {
    loggers: TopologyLogger[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Topology', href: '/topology' },
];

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

function getStatusColor(status: string) {
    switch (status) {
        case 'online': return '#10b981';
        case 'offline': return '#ef4444';
        case 'warning': return '#f59e0b';
        default: return '#6b7280';
    }
}

function getStatusBg(status: string) {
    switch (status) {
        case 'online': return 'border-emerald-500/40 shadow-emerald-500/10';
        case 'offline': return 'border-red-500/40 shadow-red-500/10';
        case 'warning': return 'border-amber-500/40 shadow-amber-500/10';
        default: return 'border-border';
    }
}

function getConnectionIcon(type: string) {
    switch (type) {
        case 'wifi': return <Wifi className="size-3.5" />;
        case '4g-lte':
        case 'cellular': return <Signal className="size-3.5" />;
        case 'ethernet': return <Cable className="size-3.5" />;
        default: return <Signal className="size-3.5" />;
    }
}

// Use offsetLeft/offsetTop to get positions unaffected by CSS transforms
function getElementCenter(el: HTMLElement, container: HTMLElement): { x: number; y: number } {
    let x = el.offsetWidth / 2;
    let y = el.offsetHeight / 2;
    let current: HTMLElement | null = el;

    while (current && current !== container) {
        x += current.offsetLeft;
        y += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
    }

    return { x, y };
}

function getElementBottom(el: HTMLElement, container: HTMLElement): { x: number; y: number } {
    const center = getElementCenter(el, container);
    return { x: center.x, y: center.y + el.offsetHeight / 2 };
}

function getElementTop(el: HTMLElement, container: HTMLElement): { x: number; y: number } {
    const center = getElementCenter(el, container);
    return { x: center.x, y: center.y - el.offsetHeight / 2 };
}

export default function Topology({ loggers }: TopologyProps) {
    // ── Zoom & Pan state ──
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const translateRef = useRef({ x: 0, y: 0 });
    const canvasElRef = useRef<HTMLDivElement>(null);

    // ── SVG line state ──
    const canvasRef = useRef<HTMLDivElement>(null);
    const cloudRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string }[]>([]);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    // ── Calculate SVG lines using offset-based positions (immune to CSS transforms) ──
    const calculateLines = useCallback(() => {
        const container = canvasRef.current;
        const cloud = cloudRef.current;
        if (!container || !cloud) return;

        const cloudBottom = getElementBottom(cloud, container);

        const newLines = cardRefs.current.map((card, i) => {
            if (!card) return null;
            const cardTop = getElementTop(card, container);

            return {
                x1: cloudBottom.x,
                y1: cloudBottom.y,
                x2: cardTop.x,
                y2: cardTop.y,
                status: loggers[i]?.status || 'offline',
            };
        }).filter(Boolean) as typeof lines;

        setCanvasSize({
            width: container.scrollWidth,
            height: container.scrollHeight,
        });
        setLines(newLines);
    }, [loggers]);

    useEffect(() => {
        calculateLines();
        window.addEventListener('resize', calculateLines);
        // Recalc after layout settles
        const t1 = setTimeout(calculateLines, 50);
        const t2 = setTimeout(calculateLines, 200);
        return () => {
            window.removeEventListener('resize', calculateLines);
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [calculateLines]);

    // ── Zoom handlers ──
    function handleZoomIn() {
        setScale(s => Math.min(MAX_ZOOM, s + ZOOM_STEP));
    }
    function handleZoomOut() {
        setScale(s => Math.max(MIN_ZOOM, s - ZOOM_STEP));
    }
    function handleReset() {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        translateRef.current = { x: 0, y: 0 };
    }

    function handleWheel(e: React.WheelEvent) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale(s => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s + delta)));
    }

    // ── Pan handlers using refs for smooth, no-rerender dragging ──
    function handlePointerDown(e: React.PointerEvent) {
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('button')) return;

        isPanningRef.current = true;
        panStartRef.current = {
            x: e.clientX - translateRef.current.x,
            y: e.clientY - translateRef.current.y,
        };
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
    }

    function handlePointerMove(e: React.PointerEvent) {
        if (!isPanningRef.current) return;

        const newX = e.clientX - panStartRef.current.x;
        const newY = e.clientY - panStartRef.current.y;
        translateRef.current = { x: newX, y: newY };

        // Direct DOM manipulation for smooth dragging (no React re-render)
        if (canvasElRef.current) {
            canvasElRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${scale})`;
        }
    }

    function handlePointerUp(e: React.PointerEvent) {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        (e.currentTarget as HTMLElement).style.cursor = 'grab';
        // Sync React state with final position
        setTranslate({ ...translateRef.current });
    }

    // Keep ref in sync when state changes from zoom/reset
    useEffect(() => {
        translateRef.current = translate;
    }, [translate]);

    const onlineCount = loggers.filter(l => l.status === 'online').length;
    const totalSensors = loggers.reduce((s, l) => s + l.sensorsCount, 0);
    const zoomPercent = Math.round(scale * 100);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Network Topology" />
            <div className="relative flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
                {/* Zoom Controls */}
                <div className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-lg border bg-background/80 p-1 shadow-sm backdrop-blur-sm">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} title="Zoom In">
                        <Plus className="size-4" />
                    </Button>
                    <span className="min-w-[3rem] text-center text-xs font-mono text-muted-foreground">{zoomPercent}%</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} title="Zoom Out">
                        <Minus className="size-4" />
                    </Button>
                    <div className="mx-0.5 h-4 w-px bg-border" />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReset} title="Reset View">
                        <Maximize className="size-4" />
                    </Button>
                </div>

                {/* Legend + Hint */}
                <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 rounded-lg border bg-background/80 px-3 py-2.5 text-[11px] shadow-sm backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#10b981" strokeWidth="2" /></svg>
                            <span className="text-muted-foreground">Online</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#f59e0b" strokeWidth="2" /></svg>
                            <span className="text-muted-foreground">Warning</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 4" /></svg>
                            <span className="text-muted-foreground">Offline</span>
                        </div>
                    </div>
                    <div className="border-t pt-1.5 text-[10px] text-muted-foreground/60">
                        Scroll to zoom · Drag to pan
                    </div>
                </div>

                {/* Pannable & Zoomable viewport */}
                <div
                    className="flex-1 overflow-hidden"
                    onWheel={handleWheel}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{ cursor: 'grab', touchAction: 'none' }}
                >
                    <div
                        ref={(el) => { canvasElRef.current = el; canvasRef.current = el; }}
                        className="relative min-h-full origin-center p-6"
                        style={{
                            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                            transformOrigin: 'center top',
                            willChange: 'transform',
                        }}
                    >
                        {/* SVG Connection Lines — uses layout coords, not screen coords */}
                        <svg
                            className="pointer-events-none absolute inset-0 z-0"
                            width={canvasSize.width}
                            height={canvasSize.height}
                            style={{ overflow: 'visible' }}
                        >
                            <defs>
                                <filter id="glow">
                                    <feGaussianBlur stdDeviation="2" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>
                            {lines.map((line, i) => {
                                const midY = line.y1 + (line.y2 - line.y1) * 0.5;
                                const path = `M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`;
                                const color = getStatusColor(line.status);
                                const isOffline = line.status === 'offline';

                                return (
                                    <g key={i}>
                                        {!isOffline && (
                                            <path
                                                d={path}
                                                fill="none"
                                                stroke={color}
                                                strokeWidth={4}
                                                strokeOpacity={0.15}
                                                filter="url(#glow)"
                                            />
                                        )}
                                        <path
                                            d={path}
                                            fill="none"
                                            stroke={color}
                                            strokeWidth={2}
                                            strokeOpacity={isOffline ? 0.4 : 0.8}
                                            strokeDasharray={isOffline ? '6 4' : 'none'}
                                            className={!isOffline ? 'topology-line-pulse' : ''}
                                        />
                                        {!isOffline && (
                                            <circle r="3" fill={color} opacity={0.9}>
                                                <animateMotion dur={`${2 + i * 0.3}s`} repeatCount="indefinite" path={path} />
                                            </circle>
                                        )}
                                    </g>
                                );
                            })}
                        </svg>

                        {/* Cloud Node */}
                        <div className="flex justify-center pb-2">
                            <div ref={cloudRef} className="relative z-10 flex flex-col items-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 shadow-lg shadow-emerald-500/10">
                                    <Globe className="size-10 text-emerald-500" />
                                </div>
                                <div className="mt-3 text-center">
                                    <h2 className="text-sm font-bold">Beacon Logger Cloud</h2>
                                    <p className="text-xs text-muted-foreground">{onlineCount}/{loggers.length} online · {totalSensors} sensors</p>
                                </div>
                            </div>
                        </div>

                        {/* Spacer */}
                        <div className="h-24 md:h-32" />

                        {/* Logger Cards */}
                        <div className="relative z-10 flex flex-wrap justify-center gap-4">
                            {loggers.map((logger, i) => (
                                <Link key={logger.id} href={`/loggers/${logger.id}`} className="block w-36 sm:w-40">
                                    <div
                                        ref={el => { cardRefs.current[i] = el; }}
                                        className={`group relative flex flex-col items-center rounded-xl border-2 bg-card p-4 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${getStatusBg(logger.status)}`}
                                    >
                                        <div className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background ${
                                            logger.status === 'online' ? 'bg-emerald-500 topology-dot-pulse' :
                                            logger.status === 'warning' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                                        }`} />

                                        {logger.modelImage ? (
                                            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg">
                                                <img src={logger.modelImage} alt={logger.model} className="h-full w-full object-contain" />
                                            </div>
                                        ) : (
                                            <div className={`flex h-24 w-24 items-center justify-center rounded-lg ${
                                                logger.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' :
                                                logger.status === 'warning' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'
                                            }`}>
                                                <Radio className="size-10" />
                                            </div>
                                        )}

                                        <h3 className="mt-2 text-xs font-semibold leading-tight line-clamp-2">{logger.name}</h3>
                                        <p className="mt-0.5 text-[10px] text-muted-foreground">{logger.model || logger.serialNumber}</p>

                                        <Badge variant="outline" className="mt-2 text-[10px] px-1.5 py-0">
                                            {logger.sensorsCount} sensor{logger.sensorsCount !== 1 ? 's' : ''}
                                        </Badge>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
