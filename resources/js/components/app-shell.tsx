import { usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AppVariant } from '@/types';

type Props = {
    children: ReactNode;
    variant?: AppVariant;
};

export function AppShell({ children, variant = 'sidebar' }: Props) {
    const isOpen = usePage().props.sidebarOpen;

    if (variant === 'header') {
        return (
            <TooltipProvider delayDuration={0}>
                <div className="flex min-h-screen w-full flex-col">{children}</div>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider delayDuration={0}>
            <SidebarProvider defaultOpen={isOpen}>{children}</SidebarProvider>
        </TooltipProvider>
    );
}
