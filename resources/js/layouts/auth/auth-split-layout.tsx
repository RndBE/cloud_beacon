import { Link, usePage } from '@inertiajs/react';
import AppLogoIcon from '@/components/app-logo-icon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { home } from '@/routes';
import type { AuthLayoutProps } from '@/types';
import { Radio, Wifi, Activity } from 'lucide-react';

export default function AuthSplitLayout({
    children,
    title,
    description,
}: AuthLayoutProps) {
    const { name } = usePage().props;

    return (
        <div className="relative grid min-h-dvh flex-col items-center justify-center lg:max-w-none lg:grid-cols-[1fr_1.1fr] lg:px-0">
            {/* Left Panel — Branded gradient with animated orbs */}
            <div className="auth-gradient-panel hidden h-full flex-col justify-between p-10 text-white lg:flex">
                {/* Floating orbs */}
                <div className="auth-orb auth-orb-1" />
                <div className="auth-orb auth-orb-2" />
                <div className="auth-orb auth-orb-3" />

                {/* Top: Logo + App Name */}
                <div className="auth-brand-enter relative z-20 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                        <AppLogoIcon className="size-6 fill-current text-white" />
                    </div>
                    <span className="text-lg font-semibold tracking-tight">
                        {(name as string) || 'Beacon Logger Cloud'}
                    </span>
                </div>

                {/* Center: Hero text */}
                <div className="auth-brand-enter relative z-20 mx-auto max-w-md space-y-6 text-center">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md">
                        <Radio className="size-10 text-blue-300" />
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight">
                        Cloud Configurator
                    </h2>
                    <p className="text-base leading-relaxed text-blue-200/80">
                        Configure, monitor, and manage your Beacon Logger devices from anywhere. Real-time telemetry at your fingertips.
                    </p>

                    {/* Feature pills */}
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                        <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
                            <Wifi className="size-4 text-emerald-300" />
                            <span>Real-time Monitoring</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
                            <Activity className="size-4 text-amber-300" />
                            <span>Sensor Analytics</span>
                        </div>
                    </div>
                </div>

                {/* Bottom: Copyright */}
                <div className="relative z-20 text-sm text-blue-200/50">
                    &copy; {new Date().getFullYear()} PT. Arta Teknologi Comunindo
                </div>
            </div>

            {/* Right Panel — Form */}
            <div className="flex w-full items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
                <div className="auth-form-enter w-full max-w-md space-y-6">
                    {/* Mobile logo */}
                    <Link
                        href={home()}
                        className="relative z-20 flex items-center justify-center gap-2 lg:hidden"
                    >
                        <AppLogoIcon className="h-10 fill-current text-foreground sm:h-12" />
                    </Link>

                    <Card className="border-0 shadow-xl lg:border lg:shadow-2xl">
                        <CardHeader className="space-y-1 px-8 pt-8 pb-2 text-center">
                            <CardTitle className="text-2xl font-bold tracking-tight">
                                {title}
                            </CardTitle>
                            <CardDescription className="text-sm">
                                {description}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-8 pb-8">
                            {children}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
