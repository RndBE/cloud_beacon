import { router } from '@inertiajs/react';
import { useEffect } from 'react';
import { notifyModuleResponse } from '@/lib/logger-toast';

// Listen to the device's spontaneous EWS/GCM pushes (via the same SSE stream the topology uses)
// and surface each as a top-right toast. Only the formatted summary is shown — never the raw
// MQTT payload. No-op when the logger has no device identifier.
export function useModuleEventToasts(deviceId: string | null | undefined) {
    useEffect(() => {
        if (!deviceId) return;

        const es = new EventSource(`/api/mqtt/modules/stream?id_logger=${encodeURIComponent(deviceId)}`);

        es.addEventListener('status', (event) => {
            try {
                const msg = JSON.parse((event as MessageEvent).data) as { module?: unknown } & Record<string, unknown>;
                if (typeof msg?.module !== 'string') return;
                // notifyModuleResponse formats EWS/GCM into a clean message and ignores everything else.
                notifyModuleResponse(msg.module, true, msg);
            } catch {
                /* ignore a malformed frame */
            }
        });

        // Close the stream before a real Inertia navigation so a single-worker server isn't blocked
        // (mirrors the topology page). Prefetch visits are ignored so the stream survives hovers.
        const stopBeforeNav = router.on('before', (event) => {
            if (!event.detail.visit.prefetch) es.close();
        });

        return () => {
            stopBeforeNav();
            es.close();
        };
    }, [deviceId]);
}
