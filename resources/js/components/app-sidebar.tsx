import { Link } from '@inertiajs/react';
import { Box, Factory, LayoutGrid, Network, Radio, Settings, Shield, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AppLogo from '@/components/app-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NavFooter } from '@/components/nav-footer';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { dashboard } from '@/routes';
import type { NavItem } from '@/types';

export function AppSidebar() {
    const { t } = useTranslation();

    const mainNavItems: NavItem[] = [
        {
            title: t('nav.dashboard'),
            href: dashboard(),
            icon: LayoutGrid,
        },
        {
            title: t('nav.topology'),
            href: '/topology',
            icon: Network,
        },
        {
            title: t('nav.loggers'),
            href: '/loggers',
            icon: Radio,
        },
        {
            title: t('nav.production'),
            href: '/production',
            icon: Factory,
        },
        {
            title: t('nav.models'),
            href: '/production/models',
            icon: Box,
        },
    ];

    const managementNavItems: NavItem[] = [
        {
            title: t('nav.roles'),
            href: '/roles',
            icon: Shield,
        },
        {
            title: t('nav.users'),
            href: '/users',
            icon: Users,
        },
    ];

    const footerNavItems: NavItem[] = [
        {
            title: t('nav.settings'),
            href: '/settings/profile',
            icon: Settings,
        },
    ];

    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={dashboard()} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={mainNavItems} />
                <NavMain items={managementNavItems} label={t('nav.management')} />
            </SidebarContent>

            <SidebarFooter>
                <NavFooter items={footerNavItems} className="mt-auto" />
                <SidebarGroup className="py-0 group-data-[collapsible=icon]:p-0">
                    <SidebarGroupContent>
                        <SidebarMenu>
                            <SidebarMenuItem>
                                <LanguageSwitcher />
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
