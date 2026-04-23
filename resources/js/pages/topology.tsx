import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Cable, ChevronDown, FolderKanban, Globe, Minus, Maximize, Plus, Radio, Signal, Wifi, Cpu, Zap, Thermometer, Droplets, Gauge } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface TopologySensor {
    id: number;
    name: string;
    type: string;
    connectionType: string | null;
    value: number;
    unit: string;
    status: string;
}

interface TopologyLogger {
    id: string;
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
    sensors: TopologySensor[];
    projectId: number | null;
    projectName: string | null;
    projectColor: string | null;
}

interface TopologyProject {
    id: number;
    name: string;
    color: string;
    loggerCount: number;
}

interface TopologyProps {
    loggers: TopologyLogger[];
    projects: TopologyProject[];
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

function getProtocolColor(connectionType: string | null) {
    switch (connectionType) {
        case 'rs485': return '#3b82f6';   // blue
        case 'rs232': return '#a855f7';   // purple
        case 'analog': return '#f97316';  // orange
        default: return '#6b7280';        // gray
    }
}

function getProtocolLabel(connectionType: string | null) {
    switch (connectionType) {
        case 'rs485': return 'RS485';
        case 'rs232': return 'RS232';
        case 'analog': return 'Analog';
        default: return 'Generic';
    }
}

function getSensorIcon(type: string) {
    switch (type) {
        case 'temperature': return <Thermometer className="size-5" />;
        case 'humidity': return <Droplets className="size-5" />;
        case 'pressure':
        case 'water-level': return <Gauge className="size-5" />;
        case 'voltage':
        case 'current': return <Zap className="size-5" />;
        default: return <Cpu className="size-5" />;
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

export default function Topology({ loggers, projects }: TopologyProps) {
    // ── State: drill-down levels ──
    // Level 1: selectedProject=null, selectedLogger=null → show project cards
    // Level 2: selectedProject set, selectedLogger=null → show loggers of that project
    // Level 3: selectedLogger set → show sensors of that logger
    const [selectedProject, setSelectedProject] = useState<TopologyProject | null>(null);
    const [selectedLogger, setSelectedLogger] = useState<TopologyLogger | null>(null);
    const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

    const filteredLoggers = useMemo(() => {
        if (!selectedProject) return [];
        return loggers.filter(l => l.projectId === selectedProject.id);
    }, [loggers, selectedProject]);

    // Current drill-down level
    const currentLevel: 'projects' | 'loggers' | 'sensors' = selectedLogger ? 'sensors' : selectedProject ? 'loggers' : 'projects';

    // ── Zoom & Pan state ──
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0 });
    const translateRef = useRef({ x: 0, y: 0 });
    const canvasElRef = useRef<HTMLDivElement>(null);

    // ── SVG line state ──
    const canvasRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string; protocol?: string | null }[]>([]);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    // ── Calculate SVG lines ──
    const calculateLines = useCallback(() => {
        const container = canvasRef.current;
        const head = headRef.current;
        if (!container || !head) return;

        const headBottom = getElementBottom(head, container);

        if (selectedLogger) {
            // Sensor sub-topology — lines from logger to sensors
            const newLines = cardRefs.current.map((card, i) => {
                if (!card) return null;
                const cardTop = getElementTop(card, container);
                const sensor = selectedLogger.sensors[i];
                return {
                    x1: headBottom.x,
                    y1: headBottom.y,
                    x2: cardTop.x,
                    y2: cardTop.y,
                    status: sensor?.status === 'active' ? 'online' : 'offline',
                    protocol: sensor?.connectionType,
                };
            }).filter(Boolean) as typeof lines;
            setCanvasSize({ width: container.scrollWidth, height: container.scrollHeight });
            setLines(newLines);
        } else if (selectedProject) {
            // Project → loggers
            const newLines = cardRefs.current.map((card, i) => {
                if (!card) return null;
                const cardTop = getElementTop(card, container);
                return {
                    x1: headBottom.x,
                    y1: headBottom.y,
                    x2: cardTop.x,
                    y2: cardTop.y,
                    status: filteredLoggers[i]?.status || 'offline',
                };
            }).filter(Boolean) as typeof lines;
            setCanvasSize({ width: container.scrollWidth, height: container.scrollHeight });
            setLines(newLines);
        } else {
            // Cloud → projects (all online lines)
            const newLines = cardRefs.current.map((card) => {
                if (!card) return null;
                const cardTop = getElementTop(card, container);
                return {
                    x1: headBottom.x,
                    y1: headBottom.y,
                    x2: cardTop.x,
                    y2: cardTop.y,
                    status: 'online',
                };
            }).filter(Boolean) as typeof lines;
            setCanvasSize({ width: container.scrollWidth, height: container.scrollHeight });
            setLines(newLines);
        }
    }, [filteredLoggers, selectedLogger, selectedProject]);

    useEffect(() => {
        calculateLines();
        window.addEventListener('resize', calculateLines);
        const t1 = setTimeout(calculateLines, 50);
        const t2 = setTimeout(calculateLines, 200);
        return () => {
            window.removeEventListener('resize', calculateLines);
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [calculateLines]);

    // ── Zoom handlers ──
    function handleZoomIn() { setScale(s => Math.min(MAX_ZOOM, s + ZOOM_STEP)); }
    function handleZoomOut() { setScale(s => Math.max(MIN_ZOOM, s - ZOOM_STEP)); }
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

    // ── Pan handlers ──
    function handlePointerDown(e: React.PointerEvent) {
        const target = e.target as HTMLElement;
        if (target.closest('a') || target.closest('button') || target.closest('[data-clickable]')) return;

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
        if (canvasElRef.current) {
            canvasElRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${scale})`;
        }
    }

    function handlePointerUp(e: React.PointerEvent) {
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        (e.currentTarget as HTMLElement).style.cursor = 'grab';
        setTranslate({ ...translateRef.current });
    }

    useEffect(() => { translateRef.current = translate; }, [translate]);

    function handleSelectProject(project: TopologyProject) {
        setSelectedProject(project);
        setSelectedLogger(null);
        cardRefs.current = [];
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        translateRef.current = { x: 0, y: 0 };
    }

    function handleSelectLogger(logger: TopologyLogger) {
        setSelectedLogger(logger);
        cardRefs.current = [];
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        translateRef.current = { x: 0, y: 0 };
    }

    function handleBack() {
        if (selectedLogger) {
            // Go back from sensors → loggers
            setSelectedLogger(null);
        } else if (selectedProject) {
            // Go back from loggers → projects
            setSelectedProject(null);
        }
        cardRefs.current = [];
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        translateRef.current = { x: 0, y: 0 };
    }

    const onlineCount = filteredLoggers.filter(l => l.status === 'online').length;
    const totalSensors = filteredLoggers.reduce((s, l) => s + l.sensorsCount, 0);
    const totalLoggersAll = loggers.length;
    const onlineLoggersAll = loggers.filter(l => l.status === 'online').length;
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

                {/* Back Button + Project Switcher (when drilled down) */}
                {(selectedProject || selectedLogger) && (
                    <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 bg-background/80 backdrop-blur-sm" onClick={handleBack}>
                            <ArrowLeft className="size-4" />
                            {selectedLogger ? `Back to ${selectedProject?.name || 'Project'}` : 'Back to Projects'}
                        </Button>

                        {/* Project switcher dropdown (visible at loggers & sensors level) */}
                        {selectedProject && (
                            <div className="relative">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 bg-background/80 backdrop-blur-sm"
                                    onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                                >
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedProject.color }} />
                                    {selectedProject.name}
                                    <ChevronDown className="size-3" />
                                </Button>
                                {projectDropdownOpen && (
                                    <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                                        {projects.map(p => (
                                            <button
                                                key={p.id}
                                                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                                                    selectedProject.id === p.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                                                }`}
                                                onClick={() => {
                                                    const proj = projects.find(pr => pr.id === p.id);
                                                    if (proj) {
                                                        setSelectedProject(proj);
                                                        setSelectedLogger(null);
                                                        cardRefs.current = [];
                                                    }
                                                    setProjectDropdownOpen(false);
                                                }}
                                            >
                                                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                                <span className="truncate">{p.name}</span>
                                                <span className="ml-auto text-[10px] text-muted-foreground">{p.loggerCount}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Legend */}
                <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 rounded-lg border bg-background/80 px-3 py-2.5 text-[11px] shadow-sm backdrop-blur-sm">
                    {currentLevel === 'sensors' ? (
                        /* Protocol-based legend for sensor view */
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#3b82f6" strokeWidth="2" /></svg>
                                <span className="text-muted-foreground">RS485</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#a855f7" strokeWidth="2" /></svg>
                                <span className="text-muted-foreground">RS232</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#f97316" strokeWidth="2" /></svg>
                                <span className="text-muted-foreground">Analog</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#6b7280" strokeWidth="2" strokeDasharray="6 4" /></svg>
                                <span className="text-muted-foreground">Generic</span>
                            </div>
                        </div>
                    ) : currentLevel === 'loggers' ? (
                        /* Status-based legend for logger view */
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
                    ) : (
                        /* Projects level legend */
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <FolderKanban className="size-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">Click a project to view its loggers</span>
                            </div>
                        </div>
                    )}
                    <div className="border-t pt-1.5 text-[10px] text-muted-foreground/60">
                        {currentLevel === 'sensors' ? 'Click card for logger detail · ' : currentLevel === 'projects' ? 'Click project to drill down · ' : 'Click logger to view sensors · '}Scroll to zoom · Drag to pan
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
                        {/* SVG Connection Lines */}
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
                                // In sensor view, use protocol color; in cloud view, use status color
                                const color = selectedLogger ? getProtocolColor(line.protocol ?? null) : getStatusColor(line.status);
                                const isOffline = line.status === 'offline';
                                const isGeneric = selectedLogger && !line.protocol;

                                return (
                                    <g key={i}>
                                        {!isOffline && !isGeneric && (
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
                                            strokeOpacity={(isOffline || isGeneric) ? 0.4 : 0.8}
                                            strokeDasharray={(isOffline || isGeneric) ? '6 4' : 'none'}
                                            className={(!isOffline && !isGeneric) ? 'topology-line-pulse' : ''}
                                        />
                                        {!isOffline && !isGeneric && (() => {
                                            // Reverse path: dot travels from logger (x2,y2) → cloud (x1,y1)
                                            const midY = line.y1 + (line.y2 - line.y1) * 0.5;
                                            const reversePath = `M ${line.x2} ${line.y2} C ${line.x2} ${midY}, ${line.x1} ${midY}, ${line.x1} ${line.y1}`;
                                            return (
                                                <circle r="3" fill={color} opacity={0.9}>
                                                    <animateMotion dur={`${2 + i * 0.3}s`} repeatCount="indefinite" path={reversePath} />
                                                </circle>
                                            );
                                        })()}
                                    </g>
                                );
                            })}
                        </svg>

                        {/* ═══════════════ HEAD NODE ═══════════════ */}
                        <div className="flex justify-center pb-2">
                            {currentLevel === 'sensors' && selectedLogger ? (
                                /* Logger as head node */
                                <div ref={headRef} className="relative z-10 flex flex-col items-center">
                                    <div className={`flex h-24 w-24 items-center justify-center rounded-full border-2 shadow-lg ${getStatusBg(selectedLogger.status)} bg-card`}>
                                        {selectedLogger.modelImage ? (
                                            <img src={selectedLogger.modelImage} alt={selectedLogger.model} className="h-16 w-16 object-contain" />
                                        ) : (
                                            <Radio className={`size-10 ${
                                                selectedLogger.status === 'online' ? 'text-emerald-500' :
                                                selectedLogger.status === 'warning' ? 'text-amber-500' : 'text-red-500'
                                            }`} />
                                        )}
                                    </div>
                                    <div className="mt-3 text-center">
                                        <h2 className="text-sm font-bold">{selectedLogger.name}</h2>
                                        <p className="text-xs text-muted-foreground">{selectedLogger.model || selectedLogger.serialNumber}</p>
                                        <p className="text-xs text-muted-foreground">{selectedLogger.sensors.length} sensor{selectedLogger.sensors.length !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                            ) : currentLevel === 'loggers' && selectedProject ? (
                                /* Project as head node */
                                <div ref={headRef} className="relative z-10 flex flex-col items-center">
                                    <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 shadow-lg bg-card" style={{ borderColor: selectedProject.color + '60', boxShadow: `0 4px 15px ${selectedProject.color}20` }}>
                                        <FolderKanban className="size-10" style={{ color: selectedProject.color }} />
                                    </div>
                                    <div className="mt-3 text-center">
                                        <h2 className="text-sm font-bold">{selectedProject.name}</h2>
                                        <p className="text-xs text-muted-foreground">{onlineCount}/{filteredLoggers.length} online · {totalSensors} sensors</p>
                                    </div>
                                </div>
                            ) : (
                                /* Cloud as head node — projects view */
                                <div ref={headRef} className="relative z-10 flex flex-col items-center">
                                    <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 shadow-lg shadow-emerald-500/10">
                                        <Globe className="size-10 text-emerald-500" />
                                    </div>
                                    <div className="mt-3 text-center">
                                        <h2 className="text-sm font-bold">Beacon Logger Cloud</h2>
                                        <p className="text-xs text-muted-foreground">{onlineLoggersAll}/{totalLoggersAll} online · {projects.length} project{projects.length !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Spacer */}
                        <div className="h-24 md:h-32" />

                        {/* ═══════════════ CHILD CARDS ═══════════════ */}
                        <div className="relative z-10 flex flex-wrap justify-center gap-4">
                            {currentLevel === 'sensors' && selectedLogger ? (
                                /* Sensor cards */
                                selectedLogger.sensors.map((sensor, i) => (
                                    <Link key={sensor.id} href={`/loggers/${selectedLogger.id}`} data-clickable className="block w-36 sm:w-40">
                                        <div
                                            ref={el => { cardRefs.current[i] = el; }}
                                            className={`group relative flex flex-col items-center rounded-xl border-2 bg-card p-4 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                                                sensor.status === 'active' ? 'border-emerald-500/40 shadow-emerald-500/10' : 'border-red-500/40 shadow-red-500/10'
                                            }`}
                                        >
                                            {/* Status dot */}
                                            <div className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background ${
                                                sensor.status === 'active' ? 'bg-emerald-500 topology-dot-pulse' : 'bg-red-500'
                                            }`} />

                                            {/* Protocol badge */}
                                            {sensor.connectionType && (
                                                <Badge
                                                    variant="outline"
                                                    className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0 font-mono uppercase bg-white"
                                                    style={{ borderColor: getProtocolColor(sensor.connectionType), color: getProtocolColor(sensor.connectionType) }}
                                                >
                                                    {getProtocolLabel(sensor.connectionType)}
                                                </Badge>
                                            )}

                                            {/* Sensor icon */}
                                            <div className={`flex h-14 w-14 items-center justify-center rounded-lg ${
                                                sensor.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                                            }`}>
                                                {getSensorIcon(sensor.type)}
                                            </div>

                                            {/* Sensor name */}
                                            <h3 className="mt-2 text-xs font-semibold leading-tight line-clamp-2">{sensor.name}</h3>
                                            <p className="mt-0.5 text-[10px] text-muted-foreground capitalize">{sensor.type.replace('-', ' ')}</p>

                                            {/* Value */}
                                            <div className="mt-1.5 rounded-md bg-muted/50 px-2 py-0.5">
                                                <span className="font-mono text-sm font-bold">{sensor.value}</span>
                                                <span className="ml-0.5 text-[10px] text-muted-foreground">{sensor.unit}</span>
                                            </div>
                                        </div>
                                    </Link>
                                ))
                            ) : currentLevel === 'loggers' ? (
                                /* Logger cards */
                                filteredLoggers.map((logger, i) => (
                                    <div key={logger.id} data-clickable className="block w-36 sm:w-40 cursor-pointer" onClick={() => handleSelectLogger(logger)}>
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

                                            <div className="mt-2 flex flex-col items-center gap-1">
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                    {logger.sensorsCount} sensor{logger.sensorsCount !== 1 ? 's' : ''}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                /* Project cards */
                                projects.map((project, i) => {
                                    const projectLoggers = loggers.filter(l => l.projectId === project.id);
                                    const projectOnline = projectLoggers.filter(l => l.status === 'online').length;
                                    return (
                                        <div key={project.id} data-clickable className="block w-40 sm:w-44 cursor-pointer" onClick={() => handleSelectProject(project)}>
                                            <div
                                                ref={el => { cardRefs.current[i] = el; }}
                                                className="group relative flex flex-col items-center rounded-xl border-2 bg-card p-5 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
                                                style={{ borderColor: project.color + '40', boxShadow: `0 4px 15px ${project.color}10` }}
                                            >
                                                {/* Color indicator */}
                                                <div className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background" style={{ backgroundColor: project.color }} />

                                                {/* Project icon */}
                                                <div className="flex h-16 w-16 items-center justify-center rounded-xl" style={{ backgroundColor: project.color + '15' }}>
                                                    <FolderKanban className="size-8" style={{ color: project.color }} />
                                                </div>

                                                {/* Project name */}
                                                <h3 className="mt-3 text-xs font-semibold leading-tight line-clamp-2">{project.name}</h3>

                                                {/* Stats */}
                                                <div className="mt-2 flex flex-col items-center gap-1">
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                        {project.loggerCount} logger{project.loggerCount !== 1 ? 's' : ''}
                                                    </Badge>
                                                    <span className="text-[9px] text-muted-foreground">
                                                        {projectOnline}/{projectLoggers.length} online
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
