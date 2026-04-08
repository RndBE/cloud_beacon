import { Head, router } from '@inertiajs/react';
import { ArrowLeft, Home, Radio, RefreshCw, Search, ShieldAlert, ServerCrash, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

interface ErrorPageProps {
    status: number;
    message?: string;
}

const ERROR_CONFIG: Record<number, { title: string; description: string; icon: React.ReactNode; color: string }> = {
    401: {
        title: 'Unauthorized',
        description: 'Anda tidak memiliki akses ke halaman ini. Silakan login terlebih dahulu.',
        icon: <ShieldAlert className="size-20" />,
        color: 'amber',
    },
    403: {
        title: 'Forbidden',
        description: 'Akses ke halaman ini dibatasi. Hubungi administrator jika Anda memerlukan akses.',
        icon: <ShieldAlert className="size-20" />,
        color: 'red',
    },
    404: {
        title: 'Page Not Found',
        description: 'Halaman yang Anda cari tidak ditemukan. Mungkin telah dipindahkan atau dihapus.',
        icon: <Search className="size-20" />,
        color: 'blue',
    },
    419: {
        title: 'Session Expired',
        description: 'Sesi Anda telah berakhir. Silakan refresh halaman dan coba lagi.',
        icon: <RefreshCw className="size-20" />,
        color: 'amber',
    },
    500: {
        title: 'Server Error',
        description: 'Terjadi kesalahan pada server. Tim kami sedang menangani masalah ini.',
        icon: <ServerCrash className="size-20" />,
        color: 'red',
    },
    503: {
        title: 'Service Unavailable',
        description: 'Layanan sedang dalam pemeliharaan. Silakan coba lagi dalam beberapa saat.',
        icon: <WifiOff className="size-20" />,
        color: 'amber',
    },
};

const COLOR_MAP: Record<string, { gradient: string; iconColor: string; glowBg: string; ring: string; badge: string }> = {
    blue: {
        gradient: 'from-blue-500/5 via-transparent to-cyan-500/5',
        iconColor: 'text-blue-500/80',
        glowBg: 'bg-blue-500/5',
        ring: 'ring-blue-500/20',
        badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    red: {
        gradient: 'from-red-500/5 via-transparent to-orange-500/5',
        iconColor: 'text-red-500/80',
        glowBg: 'bg-red-500/5',
        ring: 'ring-red-500/20',
        badge: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    },
    amber: {
        gradient: 'from-amber-500/5 via-transparent to-yellow-500/5',
        iconColor: 'text-amber-500/80',
        glowBg: 'bg-amber-500/5',
        ring: 'ring-amber-500/20',
        badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
};

export default function ErrorPage({ status, message }: ErrorPageProps) {
    const config = ERROR_CONFIG[status] ?? {
        title: 'Error',
        description: message || 'Terjadi kesalahan yang tidak diketahui.',
        icon: <ServerCrash className="size-20" />,
        color: 'red',
    };

    const colors = COLOR_MAP[config.color] ?? COLOR_MAP.blue;

    // Floating particles animation
    const [particles] = useState(() =>
        Array.from({ length: 6 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: 2 + Math.random() * 4,
            duration: 15 + Math.random() * 20,
            delay: Math.random() * -20,
        }))
    );

    return (
        <>
            <Head title={`${status} – ${config.title}`} />

            <div className={`relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br ${colors.gradient} bg-background`}>
                {/* Animated grid background */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.015]"
                    style={{
                        backgroundImage: `
                            linear-gradient(to right, currentColor 1px, transparent 1px),
                            linear-gradient(to bottom, currentColor 1px, transparent 1px)
                        `,
                        backgroundSize: '60px 60px',
                    }}
                />

                {/* Floating particles */}
                {particles.map((p) => (
                    <div
                        key={p.id}
                        className={`pointer-events-none absolute rounded-full ${colors.glowBg} opacity-40`}
                        style={{
                            left: `${p.x}%`,
                            top: `${p.y}%`,
                            width: p.size,
                            height: p.size,
                            animation: `float ${p.duration}s ease-in-out ${p.delay}s infinite`,
                        }}
                    />
                ))}

                {/* Glow orb */}
                <div className={`pointer-events-none absolute h-[500px] w-[500px] rounded-full ${colors.glowBg} blur-[160px] opacity-60`} />

                {/* Content */}
                <div className="relative z-10 flex flex-col items-center px-6 text-center">

                    {/* Status code badge */}
                    <div className={`mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium tracking-wider uppercase ${colors.badge}`}>
                        <Radio className="size-3 animate-pulse" />
                        Error {status}
                    </div>

                    {/* Icon with ring effect */}
                    <div className="relative mb-8">
                        {/* Pulse ring */}
                        <div className={`absolute inset-0 m-auto h-40 w-40 rounded-full ring-1 ${colors.ring} animate-ping opacity-20`} />
                        <div className={`absolute inset-0 m-auto h-32 w-32 rounded-full ring-1 ${colors.ring} opacity-30`} />

                        {/* Icon container */}
                        <div className={`relative flex h-40 w-40 items-center justify-center rounded-full ${colors.glowBg} ring-1 ${colors.ring}`}>
                            <div className={colors.iconColor}>
                                {config.icon}
                            </div>
                        </div>
                    </div>

                    {/* Title */}
                    <h1 className="mb-3 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                        {config.title}
                    </h1>

                    {/* Description */}
                    <p className="mb-10 max-w-md text-base leading-relaxed text-muted-foreground">
                        {message || config.description}
                    </p>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Button
                            variant="default"
                            size="lg"
                            className="gap-2"
                            onClick={() => router.visit('/dashboard')}
                        >
                            <Home className="size-4" />
                            Dashboard
                        </Button>

                        <Button
                            variant="outline"
                            size="lg"
                            className="gap-2"
                            onClick={() => window.history.back()}
                        >
                            <ArrowLeft className="size-4" />
                            Kembali
                        </Button>

                        {status === 419 && (
                            <Button
                                variant="outline"
                                size="lg"
                                className="gap-2"
                                onClick={() => window.location.reload()}
                            >
                                <RefreshCw className="size-4" />
                                Refresh
                            </Button>
                        )}
                    </div>

                    {/* Subtle branding footer */}
                    <p className="mt-16 text-xs text-muted-foreground/40">
                        Beacon Logger Cloud &mdash; PT. Arta Teknologi Comunindo
                    </p>
                </div>
            </div>

            {/* Inline keyframes for floating animation */}
            <style>{`
                @keyframes float {
                    0%, 100% { transform: translateY(0) translateX(0); }
                    25% { transform: translateY(-30px) translateX(15px); }
                    50% { transform: translateY(-10px) translateX(-20px); }
                    75% { transform: translateY(-40px) translateX(10px); }
                }
            `}</style>
        </>
    );
}
