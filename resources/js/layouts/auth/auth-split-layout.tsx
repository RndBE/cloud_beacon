import { Link, usePage } from '@inertiajs/react';
import { useTranslation } from 'react-i18next';
import AppLogoIcon from '@/components/app-logo-icon';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { home } from '@/routes';
import type { AuthLayoutProps } from '@/types';
import { Radio, Wifi, Activity, Signal, Cpu, BarChart3, Zap, ArrowUpRight } from 'lucide-react';

export default function AuthSplitLayout({
    children,
    title,
    description,
}: AuthLayoutProps) {
    const { name } = usePage().props;
    const { t } = useTranslation();

    return (
        <div className="relative grid min-h-dvh flex-col items-center justify-center lg:max-w-none lg:grid-cols-[2fr_1fr] lg:px-0">
            {/* Left Panel — Modern IoT Illustration */}
            <div className="auth-gradient-panel hidden h-full flex-col justify-between p-10 text-gray-900 lg:flex">
                {/* Background grid pattern */}
                <div className="auth-grid-pattern" />

                {/* Animated gradient mesh blobs */}
                <div className="auth-mesh auth-mesh-1" />
                <div className="auth-mesh auth-mesh-2" />
                <div className="auth-mesh auth-mesh-3" />

                {/* Top: Logo */}
                <div className="auth-brand-enter relative z-20">
                    <AppLogoIcon className="h-10 w-auto object-contain" />
                </div>

                {/* Center: IoT Network Illustration */}
                <div className="auth-brand-enter relative z-20 mx-auto w-full max-w-lg space-y-8">
                    {/* Network Topology SVG */}
                    <div className="relative mx-auto aspect-square max-w-[340px]">
                        <svg
                            viewBox="0 0 340 340"
                            fill="none"
                            className="auth-network-svg h-full w-full"
                        >
                            {/* Connection lines with animated dashes */}
                            <line x1="170" y1="170" x2="70" y2="80" className="auth-conn-line" />
                            <line x1="170" y1="170" x2="270" y2="80" className="auth-conn-line auth-conn-line-delay-1" />
                            <line x1="170" y1="170" x2="60" y2="250" className="auth-conn-line auth-conn-line-delay-2" />
                            <line x1="170" y1="170" x2="280" y2="250" className="auth-conn-line auth-conn-line-delay-3" />
                            <line x1="170" y1="170" x2="170" y2="40" className="auth-conn-line auth-conn-line-delay-1" />
                            <line x1="170" y1="170" x2="170" y2="300" className="auth-conn-line auth-conn-line-delay-2" />

                            {/* Data flow particles along lines */}
                            <circle r="3" className="auth-data-particle">
                                <animateMotion dur="2s" repeatCount="indefinite" path="M170,170 L70,80" />
                            </circle>
                            <circle r="3" className="auth-data-particle auth-data-particle-delay">
                                <animateMotion dur="2.5s" repeatCount="indefinite" path="M170,170 L270,80" />
                            </circle>
                            <circle r="3" className="auth-data-particle">
                                <animateMotion dur="3s" repeatCount="indefinite" path="M170,170 L60,250" />
                            </circle>
                            <circle r="3" className="auth-data-particle auth-data-particle-delay">
                                <animateMotion dur="2.2s" repeatCount="indefinite" path="M170,170 L280,250" />
                            </circle>
                            <circle r="3" className="auth-data-particle">
                                <animateMotion dur="1.8s" repeatCount="indefinite" path="M170,170 L170,40" />
                            </circle>
                            <circle r="3" className="auth-data-particle auth-data-particle-delay">
                                <animateMotion dur="2.8s" repeatCount="indefinite" path="M170,170 L170,300" />
                            </circle>

                            {/* Signal pulse rings from center */}
                            <circle cx="170" cy="170" r="30" className="auth-signal-ring auth-signal-ring-1" />
                            <circle cx="170" cy="170" r="30" className="auth-signal-ring auth-signal-ring-2" />
                            <circle cx="170" cy="170" r="30" className="auth-signal-ring auth-signal-ring-3" />

                            {/* Outer node circles with glow */}
                            <circle cx="70" cy="80" r="18" className="auth-node" />
                            <circle cx="270" cy="80" r="18" className="auth-node" />
                            <circle cx="60" cy="250" r="18" className="auth-node" />
                            <circle cx="280" cy="250" r="18" className="auth-node" />
                            <circle cx="170" cy="40" r="14" className="auth-node auth-node-sm" />
                            <circle cx="170" cy="300" r="14" className="auth-node auth-node-sm" />

                            {/* Center hub */}
                            <circle cx="170" cy="170" r="28" className="auth-hub" />
                            <circle cx="170" cy="170" r="20" className="auth-hub-inner" />

                            {/* Icons inside SVG as foreignObject for perfect alignment */}
                            <foreignObject x="56" y="66" width="28" height="28">
                                <div className="auth-node-icon-fo">
                                    <Wifi className="size-4" />
                                </div>
                            </foreignObject>
                            <foreignObject x="256" y="66" width="28" height="28">
                                <div className="auth-node-icon-fo">
                                    <Signal className="size-4" />
                                </div>
                            </foreignObject>
                            <foreignObject x="46" y="236" width="28" height="28">
                                <div className="auth-node-icon-fo">
                                    <Cpu className="size-4" />
                                </div>
                            </foreignObject>
                            <foreignObject x="266" y="236" width="28" height="28">
                                <div className="auth-node-icon-fo">
                                    <Activity className="size-4" />
                                </div>
                            </foreignObject>
                            <foreignObject x="152" y="152" width="36" height="36">
                                <div className="auth-node-icon-fo auth-node-icon-fo-center">
                                    <Radio className="size-5" />
                                </div>
                            </foreignObject>
                        </svg>
                    </div>

                    {/* Glassmorphic stat cards row */}
                    <div className="flex items-stretch justify-center gap-3">
                        <div className="auth-glass-card auth-float-card-1">
                            <div className="flex items-center gap-2 text-red-600">
                                <Zap className="size-3.5" />
                                <span className="text-[11px] font-medium uppercase tracking-wider opacity-70">{t('auth.active')}</span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-xl font-bold tabular-nums text-gray-900">24</span>
                                <span className="text-[10px] text-gray-500">{t('auth.devices')}</span>
                            </div>
                        </div>
                        <div className="auth-glass-card auth-float-card-2">
                            <div className="flex items-center gap-2 text-rose-600">
                                <BarChart3 className="size-3.5" />
                                <span className="text-[11px] font-medium uppercase tracking-wider opacity-70">{t('auth.uptime')}</span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-xl font-bold tabular-nums text-gray-900">99.8</span>
                                <span className="text-[10px] text-gray-500">%</span>
                            </div>
                        </div>
                        <div className="auth-glass-card auth-float-card-3">
                            <div className="flex items-center gap-2 text-amber-600">
                                <ArrowUpRight className="size-3.5" />
                                <span className="text-[11px] font-medium uppercase tracking-wider opacity-70">{t('auth.data')}</span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-xl font-bold tabular-nums text-gray-900">1.2</span>
                                <span className="text-[10px] text-gray-500">TB/mo</span>
                            </div>
                        </div>
                    </div>

                    {/* Tagline */}
                    <div className="space-y-3 text-center">
                        <h2 className="bg-gradient-to-r from-red-700 via-red-600 to-gray-900 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                            {t('auth.cloud_configurator')}
                        </h2>
                        <p className="mx-auto max-w-sm text-sm leading-relaxed text-gray-500">
                            {t('auth.cloud_tagline')}
                        </p>
                    </div>
                </div>

                {/* Bottom: Copyright */}
                <div className="relative z-20 text-xs text-gray-400">
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
                        <AppLogoIcon className="h-10 object-contain sm:h-12" />
                    </Link>

                    <div className="mb-3 flex justify-end">
                        <LanguageSwitcher variant="compact" />
                    </div>
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
