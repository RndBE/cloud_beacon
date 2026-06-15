import { Head, Link, router } from '@inertiajs/react';
import { ArrowLeft, Cable, ChevronDown, FolderKanban, Fuel, Globe, Minus, Maximize, Plus, Radio, Siren, Signal, Wifi, Cpu, Zap, Thermometer, Droplets, Gauge } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import { getCachedModules, setCachedModules, subscribeDeviceCache } from '@/lib/device-sync-cache';
import type { DeviceModule, DeviceModulePhase } from '@/lib/device-sync-cache';
import type { BreadcrumbItem } from '@/types';

interface TopologySensor {
    id: number;
    name: string;
    type: string;
    connectionType: string | null;
    value: number;
    unit: string;
    status: string;
    // RS485 parameters of the same slave share one physical device (cfg).
    modbusSlaveId: number | null;
    deviceName: string | null;
}

/**
 * A node in the sensor sub-topology. An RS485 slave becomes ONE device node whose
 * card lists every parameter (the cfg's `s` array); every other connection type
 * (RS232 / analog / digital / virtual) stays one node per sensor — 1 channel = 1 sensor.
 */
interface SensorNode {
    key: string;
    kind: 'rs485-device' | 'sensor';
    label: string;                 // device cfg name (RS485) or sensor name
    protocol: string | null;       // connectionType — drives the line/badge colour
    status: string;                // 'active' if any member is active
    members: TopologySensor[];
}

function groupSensorNodes(sensors: TopologySensor[]): SensorNode[] {
    const nodes: SensorNode[] = [];
    const rs485Index = new Map<string, SensorNode>();

    for (const s of sensors) {
        if (s.connectionType === 'rs485') {
            const key = `rs485:${s.modbusSlaveId ?? '?'}`;
            let node = rs485Index.get(key);
            if (!node) {
                node = {
                    key,
                    kind: 'rs485-device',
                    label: s.deviceName?.trim() ? s.deviceName : 'RS485 Device',
                    protocol: 'rs485',
                    status: 'inactive',
                    members: [],
                };
                rs485Index.set(key, node);
                nodes.push(node);
            }
            node.members.push(s);
            if (s.status === 'active') node.status = 'active';
        } else {
            nodes.push({
                key: `sensor:${s.id}`,
                kind: 'sensor',
                label: s.name,
                protocol: s.connectionType,
                status: s.status,
                members: [s],
            });
        }
    }

    return nodes;
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
    deviceIdentifier: string | null;
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

// Connection-dot flow animation. One pulse per ~3s cycle, then a rest — so it reads as "data being
// processed" rather than a constant stream. Bidirectional (module) links pulse forward
// (logger→module), pause ~100ms, then back (module→logger) — never both at once. Timings are
// fractions of FLOW_DUR: forward 0–20%, gap 20–23%, reverse 23–43%, rest 43–100%.
const FLOW_DUR = '5s';
const FLOW_DOT_R = 5; // dot radius (px in the SVG, scales with zoom)
const FLOW_FWD_KEYPOINTS = '0;1;1';
const FLOW_FWD_KEYTIMES = '0;0.26;1';
const FLOW_FWD_OPACITY = '0.9;0.9;0;0';
const FLOW_FWD_OPACITY_KEYTIMES = '0;0.26;0.27;1';
const FLOW_BACK_KEYPOINTS = '0;0;1;1';
const FLOW_BACK_KEYTIMES = '0;0.29;0.55;1';
const FLOW_BACK_OPACITY = '0;0;0.9;0.9;0;0';
const FLOW_BACK_OPACITY_KEYTIMES = '0;0.29;0.30;0.55;0.56;1';

// Module node + phase types live in the shared device cache so the data survives topology
// re-entry (same pattern as MAP_DATA / GET_NAME).
type ModuleNode = DeviceModule;
type ModulePhase = DeviceModulePhase;

// Parse a 3-element phase array ([R,S,T], 1 = listrik ada) into flags, or null.
function parsePhase(v: unknown): ModulePhase {
    if (Array.isArray(v) && v.length >= 3) {
        return { r: Number(v[0]) === 1, s: Number(v[1]) === 1, t: Number(v[2]) === 1 };
    }
    return null;
}

function csrfToken(): string {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

interface CommandResult {
    success: boolean;
    message?: string;
    data?: unknown;
}

// One protocol GET/SET round-trip, same endpoint the logger's protocol panel uses.
async function mqttCommand(idLogger: string, module: string, payload: unknown): Promise<CommandResult> {
    const resp = await fetch('/api/mqtt/protocol/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken() },
        body: JSON.stringify({ id_logger: idLogger, module, payload }),
    });
    return (await resp.json()) as CommandResult;
}

// A bound GCM slave as read from `GCM GET`: which module id, and its mode (1=AWGC, 2=PUMP).
type BoundModule = { id: number; mode: number };

// Placeholder card shown the instant `GCM GET` replies — label/kind/bus known, value pending.
function moduleSkeleton(m: BoundModule): ModuleNode {
    return {
        key: `gcm:${m.id}`, id: m.id, kind: m.mode === 2 ? 'PUMP' : 'AWGC', bus: 'rs485',
        label: `GCM${m.id}`, loading: true, motor: null, position: null, phase: null, status: 'active',
    };
}

// Read one module's live state (the value/condition that fills its already-plotted card).
async function readModuleState(deviceId: string, m: BoundModule): Promise<ModuleNode> {
    if (m.mode === 2) {
        // PUMP: GCM_PUMP GET → {state, phase?}. Phase R/S/T parsed when the firmware reports it.
        const p = await mqttCommand(deviceId, 'GCM_PUMP', { GCM_PUMP: { cmd: 'GET', id: m.id } });
        const pump = (p.data as { GCM_PUMP?: Record<string, unknown> } | undefined)?.GCM_PUMP;
        const state = Number(pump?.state ?? 0);
        return {
            key: `gcm:${m.id}`, id: m.id, kind: 'PUMP', bus: 'rs485', label: `GCM${m.id}`, loading: false,
            motor: state === 1 ? 'ACTIVE' : 'STOP', position: null, phase: parsePhase(pump?.phase), status: 'active',
        };
    }
    // AWGC: GCM_GATE GET → {pos, run, fault, phase:[R,S,T]}.
    const r = await mqttCommand(deviceId, 'GCM_GATE', { GCM_GATE: { cmd: 'GET', id: m.id } });
    const gate = (r.data as { GCM_GATE?: Record<string, unknown> } | undefined)?.GCM_GATE;
    const pos = Number(gate?.pos ?? 0);
    const run = Number(gate?.run ?? 0);
    const fault = Number(gate?.fault ?? 0) === 1;
    return {
        key: `gcm:${m.id}`, id: m.id, kind: 'AWGC', bus: 'rs485', label: `GCM${m.id}`, loading: false,
        motor: run === 1 ? 'OPEN' : run === 2 ? 'CLOSE' : 'STOP', position: `${pos} cm`,
        phase: parsePhase(gate?.phase), status: fault ? 'fault' : 'active',
    };
}

// Read EWS state (RS232 ch1). Returns a node only when EWS is enabled (enable=1), else null.
// EWS GET → {"EWS":{"status":"OK","enable":1,"mode":"AUTO","source":"...","last_level":1,
//            "last_value":25.5,"comm_ok":1,...}}. Horn/alert status is `last_level`.
async function readEwsNode(deviceId: string): Promise<ModuleNode | null> {
    const e = await mqttCommand(deviceId, 'EWS', { EWS: { cmd: 'GET' } });
    const inner = (e.data as { EWS?: Record<string, unknown> } | undefined)?.EWS;
    if (!e.success || !inner || Number(inner.enable) !== 1) return null;
    return {
        key: 'ews', id: 0, kind: 'EWS', bus: 'rs232', label: 'EWS', loading: false,
        motor: null, position: null, phase: null,
        status: 'active', // enabled EWS is shown as an active link (solid + animated), like GCM
        mode: inner.mode === 'AUTO' ? 'AUTO' : 'MANUAL',
        level: inner.last_level !== undefined ? Number(inner.last_level) : null,
        source: typeof inner.source === 'string' && inner.source !== 'NONE' ? inner.source : null,
        ch: inner.ch !== undefined ? Number(inner.ch) : null,
    };
}

// GCM cards first (by id), EWS last — stable order regardless of which read returns first.
function sortModuleNodes(nodes: ModuleNode[]): ModuleNode[] {
    return [...nodes].sort((a, b) => (a.kind === 'EWS' ? 1 : 0) - (b.kind === 'EWS' ? 1 : 0) || a.id - b.id);
}

// EWS alert level → label (per ews-command-reference §2.4): 0 normal, 1–3 siaga, 4–5 mute, 6–8 siaga muted.
// A negative/unknown level (e.g. -1 = belum ada level di MANUAL) shows as "—".
function ewsLevelLabel(level: number | null | undefined): string {
    if (level == null || level < 0) return '—';
    if (level === 0) return 'Normal';
    if (level >= 1 && level <= 3) return `Siaga ${level}`;
    if (level === 4 || level === 5) return 'Mute';
    if (level >= 6 && level <= 8) return `Siaga ${level - 5}`;
    return `Level ${level}`;
}

function ewsLevelColorClass(level: number | null | undefined): string {
    if (level == null || level < 0 || level === 4 || level === 5) return 'text-muted-foreground';
    if (level === 0) return 'text-emerald-600';
    if (level === 1 || level === 6) return 'text-amber-600';
    if (level === 2 || level === 7) return 'text-orange-600';
    return 'text-red-600'; // 3 / 8
}

// EWS status dot colour by alert level — so a live EWS_EVENT visibly changes the card's status.
function ewsDotClass(level: number | null | undefined): string {
    if (level == null || level < 0 || level === 0 || level === 4 || level === 5) return 'bg-emerald-500 topology-dot-pulse';
    if (level === 1 || level === 6) return 'bg-amber-500 topology-dot-pulse';
    if (level === 2 || level === 7) return 'bg-orange-500 topology-dot-pulse';
    return 'bg-red-500 topology-dot-pulse'; // 3 / 8 — siaga tertinggi
}

// Merge a spontaneous pub status push into an existing node. Only fields present in the push
// are updated — transition messages (e.g. "Gate CLOSING") omit `phase`, so we keep the last one.
function mergeModuleMessage(node: ModuleNode, msg: Record<string, unknown>): ModuleNode {
    const next: ModuleNode = { ...node, loading: false };
    if (node.kind === 'EWS') {
        // EWS push carries last_level; EWS_EVENT carries level. Either updates the horn status.
        if (msg.last_level !== undefined) next.level = Number(msg.last_level);
        else if (msg.level !== undefined) next.level = Number(msg.level);
        if (msg.mode === 'AUTO' || msg.mode === 'MANUAL') next.mode = msg.mode;
        if (msg.ch !== undefined) next.ch = Number(msg.ch);
    } else if (node.kind === 'AWGC') {
        if (msg.run !== undefined) {
            const run = Number(msg.run);
            next.motor = run === 1 ? 'OPEN' : run === 2 ? 'CLOSE' : 'STOP';
        }
        if (msg.pos !== undefined) next.position = `${Number(msg.pos)} cm`;
        if (msg.fault !== undefined) next.status = Number(msg.fault) === 1 ? 'fault' : 'active';
        if (msg.phase !== undefined) next.phase = parsePhase(msg.phase);
    } else {
        if (msg.state !== undefined) next.motor = Number(msg.state) === 1 ? 'ACTIVE' : 'STOP';
        if (msg.phase !== undefined) next.phase = parsePhase(msg.phase);
    }
    return next;
}

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

// Tailwind text colour for a module motor state.
function motorColorClass(motor: string): string {
    switch (motor) {
        case 'OPEN':
        case 'ACTIVE': return 'text-emerald-600';
        case 'CLOSE': return 'text-amber-600';
        default: return 'text-muted-foreground'; // STOP
    }
}

// Compact R/S/T phase indicator: green letter = listrik aktif, gray = non-active.
function PhaseIndicator({ phase }: { phase: ModulePhase }) {
    if (!phase) return <span className="text-[10px] text-muted-foreground/60">n/a</span>;
    const cell = (label: string, on: boolean) => (
        <span
            title={`Phase ${label}: ${on ? 'ACTIVE' : 'NON-ACTIVE'}`}
            className={`flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${
                on ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground/50'
            }`}
        >
            {label}
        </span>
    );
    return (
        <span className="flex gap-1">
            {cell('R', phase.r)}
            {cell('S', phase.s)}
            {cell('T', phase.t)}
        </span>
    );
}

// Custom "pintu air bendungan" (dam sluice/floodgate) icon — lucide has none. Drawn in lucide's
// stroke style: a hoist frame with side guide rails, a raised slatted gate panel, and water below.
function DamGateIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M3 4h18" />        {/* hoist beam */}
            <path d="M6 4v9" />         {/* left guide rail */}
            <path d="M18 4v9" />        {/* right guide rail */}
            <rect x="9" y="6" width="6" height="6" rx="0.5" /> {/* raised gate panel */}
            <path d="M9 9h6" />         {/* gate slat */}
            <path d="M3 18q2-2 4 0t4 0t4 0t4 0" /> {/* water flowing below */}
        </svg>
    );
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

    // Sensor sub-topology nodes: RS485 slaves collapse into a single device card,
    // everything else stays one card per sensor.
    const sensorNodes = useMemo(
        () => (selectedLogger ? groupSensorNodes(selectedLogger.sensors) : []),
        [selectedLogger],
    );

    // ── Live GCM module nodes (read over MQTT when a logger is selected) ──
    const [moduleNodes, setModuleNodes] = useState<ModuleNode[]>([]);
    const [modulesLoading, setModulesLoading] = useState(false);
    // Live ref to the current nodes so the SSE handler can merge pushes without re-subscribing.
    const moduleNodesRef = useRef<ModuleNode[]>([]);
    useEffect(() => { moduleNodesRef.current = moduleNodes; }, [moduleNodes]);

    // Stable signature of WHICH modules exist (not their values) — drives the SSE connection so it
    // opens once modules are discovered and doesn't reconnect every time a value updates.
    const moduleKeysSig = useMemo(() => moduleNodes.map((n) => n.key).sort().join(','), [moduleNodes]);

    // Combined per-card line metadata for the sensor level, in render order:
    // sensor/device cards first, then module cards (which animate bidirectionally).
    const childMeta = useMemo(
        () => [
            ...sensorNodes.map((n) => ({ status: n.status === 'active' ? 'online' : 'offline', protocol: n.protocol ?? null, bidirectional: false })),
            ...moduleNodes.map((m) => ({ status: m.status === 'fault' ? 'offline' : 'online', protocol: m.bus, bidirectional: true })),
        ],
        [sensorNodes, moduleNodes],
    );

    // Modules when a logger is selected. CACHE-FIRST, exactly like MAP_DATA / GET_NAME: a re-entry
    // (leave the topology and come back) reuses the cached read with NO new request. First visit
    // discovers GCM (RS485) and EWS (RS232) concurrently — GCM is two-stage (plot skeleton cards on
    // `GCM GET`, then stream each module's value in), EWS appears once its single GET resolves.
    useEffect(() => {
        const deviceId = selectedLogger?.deviceIdentifier;
        if (!selectedLogger || !deviceId) { setModuleNodes([]); setModulesLoading(false); return; }

        // Cache hit → show last-known modules instantly, no device round-trip. SSE then keeps them live.
        const cached = getCachedModules(deviceId);
        if (cached) {
            setModuleNodes(cached);
            setModulesLoading(false);
            return;
        }

        let cancelled = false;
        setModulesLoading(true);
        setModuleNodes([]);

        (async () => {
            try {
                // PHASE A — discovery, low contention (only 2 reads at once): GCM binding + EWS state.
                // Reading EWS here (not alongside the 4 gate reads) keeps the device from starving it.
                const [gcmRes, ewsNode] = await Promise.all([
                    mqttCommand(deviceId, 'GCM', { GCM: { cmd: 'GET' } }),
                    readEwsNode(deviceId),
                ]);
                if (cancelled) return;

                const gInner = (gcmRes.data as { GCM?: Record<string, unknown> } | undefined)?.GCM;
                const gcmEnabled = gcmRes.success && gInner && Number(gInner.enable) === 1;
                const bound: BoundModule[] = gcmEnabled
                    ? ([1, 2, 3, 4, 5] as const)
                        .map((n) => {
                            const v = gInner![`id${n}`];
                            const slave = Array.isArray(v) ? Number(v[0] ?? 0) : 0;
                            const mode = Array.isArray(v) && Number(v[1]) === 2 ? 2 : 1;
                            return { id: n, slave, mode };
                        })
                        .filter((m) => m.slave > 0)
                        .map(({ id, mode }) => ({ id, mode }))
                    : [];

                // Plot GCM skeletons + the EWS card right away (EWS already has its full state).
                const collected = new Map<string, ModuleNode>();
                [...bound.map(moduleSkeleton), ...(ewsNode ? [ewsNode] : [])].forEach((n) => collected.set(n.key, n));
                setModuleNodes(sortModuleNodes([...collected.values()]));
                setModulesLoading(false);

                // PHASE B — fill each GCM module's value/condition as its reply arrives.
                await Promise.all(bound.map(async (m) => {
                    const node = await readModuleState(deviceId, m);
                    if (cancelled) return;
                    collected.set(node.key, node);
                    setModuleNodes(sortModuleNodes([...collected.values()]));
                }));

                if (!cancelled) setCachedModules(deviceId, sortModuleNodes([...collected.values()])); // persist
            } catch {
                if (!cancelled) { setModuleNodes([]); setModulesLoading(false); }
            }
        })();

        return () => { cancelled = true; };
    }, [selectedLogger]);

    // Live status: listen to the device's spontaneous pub pushes via SSE (no GET to the device).
    // The logger publishes GCM_GATE / GCM_PUMP status whenever the motor/gate changes, and the
    // server relays each one here — we merge it into the matching card. EventSource auto-reconnects.
    useEffect(() => {
        const deviceId = selectedLogger?.deviceIdentifier;
        if (!deviceId || moduleKeysSig === '') return; // no modules → nothing to listen for

        const es = new EventSource(`/api/mqtt/modules/stream?id_logger=${encodeURIComponent(deviceId)}`);

        es.addEventListener('status', (event) => {
            try {
                const msg = JSON.parse((event as MessageEvent).data) as { module: string; id?: number } & Record<string, unknown>;
                // EWS pushes (EWS / EWS_EVENT) carry no id → the single 'ews' node; GCM keys by id.
                const key = msg.module === 'EWS' || msg.module === 'EWS_EVENT' ? 'ews' : `gcm:${msg.id}`;
                if (!moduleNodesRef.current.some((n) => n.key === key)) return; // not one of ours
                const next = moduleNodesRef.current.map((n) => (n.key === key ? mergeModuleMessage(n, msg) : n));
                setModuleNodes(next);
                setCachedModules(deviceId, next); // keep the cache live for instant re-entry
            } catch { /* ignore a malformed frame */ }
        });

        // Close the stream the instant a real Inertia navigation begins. The SSE holds a server
        // worker open; on a single-worker server (e.g. `php artisan serve`) a still-open stream
        // would block the next page's request and the navigation would hang. Skip prefetch visits
        // (e.g. hovering a sidebar link) so live updates aren't killed while we stay on the page.
        const stopBeforeNav = router.on('before', (event) => {
            if (!event.detail.visit.prefetch) es.close();
        });

        return () => { stopBeforeNav(); es.close(); };
    }, [selectedLogger, moduleKeysSig]);

    // Re-hydrate if the module cache changes elsewhere (keeps parity with the other cached reads).
    useEffect(() => {
        const deviceId = selectedLogger?.deviceIdentifier;
        if (!deviceId) return;
        return subscribeDeviceCache(() => {
            const cached = getCachedModules(deviceId);
            if (cached) setModuleNodes(cached);
        });
    }, [selectedLogger]);

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
    const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; status: string; protocol?: string | null; bidirectional?: boolean }[]>([]);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    // ── Calculate SVG lines ──
    const calculateLines = useCallback(() => {
        const container = canvasRef.current;
        const head = headRef.current;
        if (!container || !head) return;

        const headBottom = getElementBottom(head, container);

        if (selectedLogger) {
            // Sensor sub-topology — lines from logger to sensor/device cards and module cards.
            const newLines = childMeta.map((meta, i) => {
                const card = cardRefs.current[i];
                if (!card) return null;
                const cardTop = getElementTop(card, container);
                return {
                    x1: headBottom.x,
                    y1: headBottom.y,
                    x2: cardTop.x,
                    y2: cardTop.y,
                    status: meta.status,
                    protocol: meta.protocol,
                    bidirectional: meta.bidirectional,
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
    }, [filteredLoggers, selectedLogger, selectedProject, childMeta]);

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
                                        {!isOffline && (() => {
                                            // Reverse path: dot travels from child (x2,y2) → logger (x1,y1).
                                            const midY = line.y1 + (line.y2 - line.y1) * 0.5;
                                            const reversePath = `M ${line.x2} ${line.y2} C ${line.x2} ${midY}, ${line.x1} ${midY}, ${line.x1} ${line.y1}`;
                                            // Stagger lines so they don't all pulse in perfect lockstep.
                                            const begin = `-${((i * 1.1) % 5).toFixed(2)}s`;
                                            return (
                                                <>
                                                    {/* Primary pulse: logger→module command (bidirectional) or child→logger telemetry */}
                                                    <circle r={FLOW_DOT_R} fill={color} opacity={0.9}>
                                                        <animateMotion dur={FLOW_DUR} begin={begin} repeatCount="indefinite" calcMode="linear"
                                                            keyPoints={FLOW_FWD_KEYPOINTS} keyTimes={FLOW_FWD_KEYTIMES}
                                                            path={line.bidirectional ? path : reversePath} />
                                                        <animate attributeName="opacity" dur={FLOW_DUR} begin={begin} repeatCount="indefinite"
                                                            values={FLOW_FWD_OPACITY} keyTimes={FLOW_FWD_OPACITY_KEYTIMES} />
                                                    </circle>
                                                    {/* Return pulse: module→logger status reply, after a ~150ms gap (bidirectional only) */}
                                                    {line.bidirectional && (
                                                        <circle r={FLOW_DOT_R} fill={color} opacity={0}>
                                                            <animateMotion dur={FLOW_DUR} begin={begin} repeatCount="indefinite" calcMode="linear"
                                                                keyPoints={FLOW_BACK_KEYPOINTS} keyTimes={FLOW_BACK_KEYTIMES} path={reversePath} />
                                                            <animate attributeName="opacity" dur={FLOW_DUR} begin={begin} repeatCount="indefinite"
                                                                values={FLOW_BACK_OPACITY} keyTimes={FLOW_BACK_OPACITY_KEYTIMES} />
                                                        </circle>
                                                    )}
                                                </>
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
                                        <p className="text-xs text-muted-foreground">
                                            {selectedLogger.sensors.length} sensor{selectedLogger.sensors.length !== 1 ? 's' : ''}
                                            {moduleNodes.length > 0 && ` · ${moduleNodes.length} module${moduleNodes.length !== 1 ? 's' : ''}`}
                                        </p>
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
                                <>
                                {/* Sensor / device cards */}
                                {sensorNodes.map((node, i) => {
                                    const isActive = node.status === 'active';
                                    const protocolColor = getProtocolColor(node.protocol ?? null);

                                    if (node.kind === 'rs485-device') {
                                        // ONE RS485 device (cfg) → card titled by the device name, listing
                                        // each parameter (name · value · small unit) in rows.
                                        return (
                                            <Link key={node.key} href={`/loggers/${selectedLogger.id}`} data-clickable className="block h-full w-48 sm:w-52">
                                                <div
                                                    ref={el => { cardRefs.current[i] = el; }}
                                                    className={`group relative flex h-full flex-col rounded-xl border-2 bg-card p-4 shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                                                        isActive ? 'border-emerald-500/40 shadow-emerald-500/10' : 'border-red-500/40 shadow-red-500/10'
                                                    }`}
                                                >
                                                    {/* Status dot */}
                                                    <div className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background ${
                                                        isActive ? 'bg-emerald-500 topology-dot-pulse' : 'bg-red-500'
                                                    }`} />

                                                    {/* Protocol badge */}
                                                    <Badge
                                                        variant="outline"
                                                        className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0 font-mono uppercase bg-white"
                                                        style={{ borderColor: protocolColor, color: protocolColor }}
                                                    >
                                                        {getProtocolLabel(node.protocol)}
                                                    </Badge>

                                                    {/* Device header (cfg name) */}
                                                    <div className="flex items-center gap-2">
                                                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                                            isActive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                                                        }`}>
                                                            <Cpu className="size-5" />
                                                        </div>
                                                        <h3 className="min-w-0 flex-1 text-xs font-semibold leading-tight line-clamp-2">{node.label}</h3>
                                                    </div>

                                                    {/* Parameter rows */}
                                                    <div className="mt-3 flex flex-col divide-y divide-border/60">
                                                        {node.members.map(param => (
                                                            <div key={param.id} className="flex items-baseline justify-between gap-2 py-1">
                                                                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={param.name}>{param.name}</span>
                                                                <span className="shrink-0 whitespace-nowrap">
                                                                    <span className="font-mono text-xs font-bold">{param.value}</span>
                                                                    <span className="ml-0.5 text-[9px] text-muted-foreground">{param.unit}</span>
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </Link>
                                        );
                                    }

                                    // Single sensor (RS232 / analog / digital / virtual): 1 channel = 1 sensor.
                                    const sensor = node.members[0];
                                    return (
                                        <Link key={node.key} href={`/loggers/${selectedLogger.id}`} data-clickable className="block h-full w-36 sm:w-40">
                                            <div
                                                ref={el => { cardRefs.current[i] = el; }}
                                                className={`group relative flex h-full flex-col items-center rounded-xl border-2 bg-card p-4 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                                                    isActive ? 'border-emerald-500/40 shadow-emerald-500/10' : 'border-red-500/40 shadow-red-500/10'
                                                }`}
                                            >
                                                {/* Status dot */}
                                                <div className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background ${
                                                    isActive ? 'bg-emerald-500 topology-dot-pulse' : 'bg-red-500'
                                                }`} />

                                                {/* Protocol badge */}
                                                {sensor.connectionType && (
                                                    <Badge
                                                        variant="outline"
                                                        className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0 font-mono uppercase bg-white"
                                                        style={{ borderColor: protocolColor, color: protocolColor }}
                                                    >
                                                        {getProtocolLabel(sensor.connectionType)}
                                                    </Badge>
                                                )}

                                                {/* Sensor icon */}
                                                <div className={`flex h-14 w-14 items-center justify-center rounded-lg ${
                                                    isActive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
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
                                    );
                                })}

                                {/* GCM module cards (live over MQTT) — bidirectional link to the logger */}
                                {moduleNodes.map((mod, j) => {
                                    const i = sensorNodes.length + j;
                                    const isFault = mod.status === 'fault';
                                    // GCM rides the RS485 bus → reuse the RS485 colour (no module-specific colour).
                                    const busColor = getProtocolColor(mod.bus);
                                    return (
                                        <Link key={mod.key} href={`/loggers/${selectedLogger.id}`} data-clickable className="block h-full w-48 sm:w-52">
                                            <div
                                                ref={el => { cardRefs.current[i] = el; }}
                                                className={`group relative flex h-full flex-col rounded-xl border-2 bg-card p-4 shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                                                    isFault ? 'border-red-500/40 shadow-red-500/10' : ''
                                                }`}
                                                style={isFault ? undefined : { borderColor: busColor + '66' }}
                                            >
                                                {/* Status dot — EWS reflects its live alert level, GCM its fault state */}
                                                <div className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-background ${
                                                    mod.kind === 'EWS' ? ewsDotClass(mod.level)
                                                        : isFault ? 'bg-red-500' : 'bg-emerald-500 topology-dot-pulse'
                                                }`} />

                                                {/* Module badge — bus protocol colour */}
                                                <Badge
                                                    variant="outline"
                                                    className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0 font-mono uppercase bg-white"
                                                    style={{ borderColor: busColor, color: busColor }}
                                                >
                                                    {mod.kind}
                                                </Badge>

                                                {/* Module header */}
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                                                        style={isFault ? undefined : { backgroundColor: busColor + '1a', color: busColor }}
                                                    >
                                                        {mod.kind === 'EWS' ? <Siren className={`size-5 ${isFault ? 'text-red-500' : ''}`} />
                                                            : mod.kind === 'PUMP' ? <Fuel className={`size-5 ${isFault ? 'text-red-500' : ''}`} />
                                                                : <DamGateIcon className={`size-5 ${isFault ? 'text-red-500' : ''}`} />}
                                                    </div>
                                                    <h3 className="min-w-0 flex-1 text-xs font-semibold leading-tight">{mod.label}</h3>
                                                </div>

                                                {/* Detail rows — value/condition stream in once loaded */}
                                                <div className="mt-3 flex flex-col divide-y divide-border/60">
                                                    {mod.kind === 'EWS' ? (
                                                        <>
                                                            {/* RS232 channel (configurable) */}
                                                            <div className="flex items-baseline justify-between gap-2 py-1">
                                                                <span className="text-[11px] text-muted-foreground">Channel</span>
                                                                <span className="font-mono text-xs font-bold">{mod.ch != null ? `RS232 · ${mod.ch}` : 'RS232'}</span>
                                                            </div>
                                                            {/* EWS mode */}
                                                            <div className="flex items-baseline justify-between gap-2 py-1">
                                                                <span className="text-[11px] text-muted-foreground">Mode</span>
                                                                <span className="font-mono text-xs font-bold">{mod.mode ?? '—'}</span>
                                                            </div>
                                                            {/* EWS alert level */}
                                                            <div className="flex items-baseline justify-between gap-2 py-1">
                                                                <span className="text-[11px] text-muted-foreground">Level</span>
                                                                <span className={`font-mono text-xs font-bold ${isFault ? 'text-red-600' : ewsLevelColorClass(mod.level)}`}>
                                                                    {ewsLevelLabel(mod.level)}
                                                                </span>
                                                            </div>
                                                            {/* AUTO source sensor */}
                                                            {mod.mode === 'AUTO' && mod.source && (
                                                                <div className="flex items-baseline justify-between gap-2 py-1">
                                                                    <span className="text-[11px] text-muted-foreground">Source</span>
                                                                    <span className="max-w-[60%] truncate font-mono text-[11px]" title={mod.source}>{mod.source}</span>
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <>
                                                            {/* Gate position (AWGC only) */}
                                                            {mod.kind === 'AWGC' && (
                                                                <div className="flex items-baseline justify-between gap-2 py-1">
                                                                    <span className="text-[11px] text-muted-foreground">Gate Position</span>
                                                                    {mod.loading
                                                                        ? <span className="h-2.5 w-10 animate-pulse rounded bg-muted" />
                                                                        : <span className="font-mono text-xs font-bold">{mod.position}</span>}
                                                                </div>
                                                            )}
                                                            {/* Motor status */}
                                                            <div className="flex items-baseline justify-between gap-2 py-1">
                                                                <span className="text-[11px] text-muted-foreground">Motor</span>
                                                                {mod.loading
                                                                    ? <span className="h-2.5 w-10 animate-pulse rounded bg-muted" />
                                                                    : <span className={`font-mono text-xs font-bold ${isFault ? 'text-red-600' : motorColorClass(mod.motor ?? '')}`}>
                                                                        {isFault ? 'FAULT' : mod.motor}
                                                                    </span>}
                                                            </div>
                                                            {/* Phase R/S/T */}
                                                            <div className="flex items-center justify-between gap-2 py-1.5">
                                                                <span className="text-[11px] text-muted-foreground">Phase</span>
                                                                {mod.loading
                                                                    ? <span className="h-3.5 w-12 animate-pulse rounded bg-muted" />
                                                                    : <PhaseIndicator phase={mod.phase} />}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}

                                {/* Loading hint while module state is being read over MQTT */}
                                {modulesLoading && (
                                    <div className="flex h-full w-36 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 p-4 text-center sm:w-40">
                                        <span className="text-[10px] text-muted-foreground">Reading modules…</span>
                                    </div>
                                )}
                                </>
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
