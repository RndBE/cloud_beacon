import { Head, router } from '@inertiajs/react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import { getCloudSshDisplayName } from './display-name';

interface TerminalDevice {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// wsPath bisa berupa path relatif ("/cloud-ssh/ws", diproxy nginx) atau URL penuh
// ws(s):// untuk pengembangan lokal tanpa proxy.
function buildWsUrl(wsPath: string, token: string): string {
    if (wsPath.startsWith('ws://') || wsPath.startsWith('wss://')) {
        return `${wsPath}?token=${encodeURIComponent(token)}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}${wsPath}?token=${encodeURIComponent(token)}`;
}

export default function CloudSshTerminal({ device, wsPath }: { device: TerminalDevice; wsPath: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>('connecting');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const displayName = getCloudSshDisplayName(device.name);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Cloud SSH', href: '/cloud-ssh' },
        { title: displayName, href: `/cloud-ssh/${device.id}/terminal` },
    ];

    const connect = useCallback(
        async (term: Terminal) => {
            setStatus('connecting');
            setErrorMsg(null);

            let token: string;
            let path = wsPath;
            try {
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
                const res = await fetch(`/cloud-ssh/${device.id}/session`, {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken },
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                token = data.token;
                path = data.ws_path ?? wsPath;
            } catch (err) {
                setStatus('error');
                setErrorMsg(`Gagal membuat sesi: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }

            const ws = new WebSocket(buildWsUrl(path, token));
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'status' && msg.status === 'connected') {
                            setStatus('connected');
                            term.focus();
                        } else if (msg.type === 'error') {
                            setStatus('error');
                            setErrorMsg(msg.message ?? 'Kesalahan tidak diketahui.');
                        }
                    } catch {
                        // abaikan frame teks yang bukan JSON
                    }
                    return;
                }
                term.write(new Uint8Array(event.data));
            };

            ws.onclose = () => {
                setStatus((prev) => (prev === 'error' ? prev : 'disconnected'));
                wsRef.current = null;
            };

            ws.onerror = () => {
                setStatus('error');
                setErrorMsg((prev) => prev ?? 'Koneksi WebSocket gagal.');
            };
        },
        [device.id, wsPath],
    );

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            theme: {
                background: '#0a0a0a',
                foreground: '#e5e5e5',
                cursor: '#e5e5e5',
            },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        fit.fit();
        termRef.current = term;

        term.onData((data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'input', data }));
            }
        });
        term.onResize(({ cols, rows }) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

        const observer = new ResizeObserver(() => fit.fit());
        observer.observe(containerRef.current);

        void connect(term);

        return () => {
            observer.disconnect();
            wsRef.current?.close();
            wsRef.current = null;
            term.dispose();
            termRef.current = null;
        };
        // attempt: dependensi sengaja — naikkan attempt = buka koneksi baru.
    }, [connect, attempt]);

    const statusBadge: Record<ConnectionStatus, { label: string; className: string }> = {
        connecting: { label: 'Menghubungkan…', className: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' },
        connected: { label: 'Terhubung', className: 'bg-green-500/15 text-green-600 dark:text-green-400' },
        disconnected: { label: 'Terputus', className: 'bg-muted text-muted-foreground' },
        error: { label: 'Gagal', className: 'bg-destructive/15 text-destructive' },
    };

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`Terminal — ${displayName}`} />
            <div className="flex h-full flex-1 flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                        <Button size="sm" variant="outline" onClick={() => router.visit('/cloud-ssh')}>
                            <ArrowLeft className="mr-1 size-4" /> Kembali
                        </Button>
                        <p className="font-medium leading-tight">{displayName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={statusBadge[status].className}>
                            {statusBadge[status].label}
                        </Badge>
                        {(status === 'disconnected' || status === 'error') && (
                            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                                <RotateCcw className="mr-1 size-4" /> Sambung Ulang
                            </Button>
                        )}
                    </div>
                </div>

                {errorMsg && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                        {errorMsg}
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-[#0a0a0a] p-2">
                    <div ref={containerRef} className="h-full w-full" />
                </div>
            </div>
        </AppLayout>
    );
}
