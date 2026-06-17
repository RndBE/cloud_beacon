import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { dismissToast, subscribeToasts } from '@/lib/logger-toast';
import type { LoggerToast } from '@/lib/logger-toast';

const AUTO_DISMISS_MS = 6000;

// Renders the logger MQTT-reply toasts in the top-right corner. Mount once per page.
export function LoggerToaster() {
    const [toasts, setToasts] = useState<LoggerToast[]>([]);

    useEffect(() => subscribeToasts(setToasts), []);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} />
            ))}
        </div>,
        document.body,
    );
}

function ToastItem({ toast }: { toast: LoggerToast }) {
    useEffect(() => {
        const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
        return () => clearTimeout(timer);
    }, [toast.id]);

    const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? CircleAlert : Info;
    const accent =
        toast.variant === 'success' ? 'text-emerald-500' : toast.variant === 'error' ? 'text-red-500' : 'text-blue-500';

    return (
        <div className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-3 shadow-lg animate-in fade-in slide-in-from-right-4 duration-200">
            <Icon className={`mt-0.5 size-5 shrink-0 ${accent}`} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">{toast.title}</p>
                {toast.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{toast.description}</p>}
            </div>
            <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Tutup notifikasi"
            >
                <X className="size-4" />
            </button>
        </div>
    );
}
