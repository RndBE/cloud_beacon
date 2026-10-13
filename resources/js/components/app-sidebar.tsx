import { Link, usePage } from '@inertiajs/react';
import {
    ArrowUpDown,
    Box,
    ClipboardCheck,
    Factory,
    FlaskConical,
    FolderKanban,
    Layers,
    LayoutGrid,
    Network,
    Radio,
    Settings,
    Shield,
    TerminalSquare,
    Usb,
    Users,
    Wrench,
} from 'lucide-react';
import { useState } from 'react';
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
import {
    readStoredSidebarGroups,
    storeSidebarGroups,
} from '@/lib/sidebar-group-preference';
import type { SidebarGroupId } from '@/lib/sidebar-group-preference';
import { dashboard } from '@/routes';
import type { NavItem } from '@/types';

type PermissionNavItem = NavItem & {
    permission?: string;
};

export function AppSidebar() {
    const { t } = useTranslation();
    const { auth } = usePage<{ auth: { permissions?: string[] } }>().props;
    const permissions = auth.permissions ?? [];
    const canView = (permission?: string) =>
        !permission || permissions.includes(permission);
    const visibleItems = (items: PermissionNavItem[]): NavItem[] =>
        items.filter((item) => canView(item.permission));
    const [openGroups, setOpenGroups] = useState(readStoredSidebarGroups);

    function updateGroupOpen(groupId: SidebarGroupId, open: boolean) {
        const nextState = { ...openGroups, [groupId]: open };
        setOpenGroups(nextState);
        storeSidebarGroups(nextState);
    }

    const overviewNavItems = visibleItems([
        {
            title: t('nav.dashboard'),
            href: dashboard(),
            icon: LayoutGrid,
            permission: 'dashboard.view',
        },
        {
            title: t('nav.topology'),
            href: '/topology',
            icon: Network,
            permission: 'topology.view',
        },
    ]);

    const monitoringNavItems = visibleItems([
        {
            title: t('nav.loggers'),
            href: '/loggers',
            icon: Radio,
            permission: 'loggers.view',
        },
        {
            title: 'Projects',
            href: '/projects',
            icon: FolderKanban,
            permission: 'loggers.view',
        },
        {
            title: 'Forwarding Logs',
            href: '/forwarding-logs',
            icon: ArrowUpDown,
            permission: 'loggers.view',
        },
        {
            title: 'Data Audit',
            href: '/data-audit',
            icon: ClipboardCheck,
            permission: 'loggers.view',
        },
    ]);

    const productionNavItems = visibleItems([
        {
            title: t('nav.production'),
            href: '/production',
            icon: Factory,
            permission: 'production.view',
        },
        {
            title: t('nav.models'),
            href: '/production/models',
            icon: Box,
            permission: 'production.view',
        },
        {
            title: 'Setup Logger (USB)',
            href: '/production/provision',
            icon: Usb,
            permission: 'production.provision',
        },
        {
            title: 'Testing Logger',
            href: '/production/testing',
            icon: FlaskConical,
            permission: 'production.testing',
        },
        {
            title: 'Mode Profiles',
            href: '/production/mode-profiles',
            icon: Layers,
            permission: 'production.mode-profiles',
        },
    ]);

    const operationsNavItems = visibleItems([
        {
            title: 'Maintenance',
            href: '/maintenance',
            icon: Wrench,
            permission: 'maintenance.view',
        },
        {
            title: 'Cloud SSH',
            href: '/cloud-ssh',
            icon: TerminalSquare,
            permission: 'cloudssh.view',
        },
    ]);

    const managementNavItems = visibleItems([
        {
            title: t('nav.roles'),
            href: '/roles',
            icon: Shield,
            permission: 'roles.view',
        },
        {
            title: t('nav.users'),
            href: '/users',
            icon: Users,
            permission: 'users.view',
        },
    ]);

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
                <NavMain
                    items={overviewNavItems}
                    label="Overview"
                    open={openGroups.overview}
                    onOpenChange={(open) => updateGroupOpen('overview', open)}
                />
                <NavMain
                    items={monitoringNavItems}
                    label="Monitoring"
                    open={openGroups.monitoring}
                    onOpenChange={(open) => updateGroupOpen('monitoring', open)}
                />
                <NavMain
                    items={productionNavItems}
                    label="Production"
                    open={openGroups.production}
                    onOpenChange={(open) => updateGroupOpen('production', open)}
                />
                <NavMain
                    items={operationsNavItems}
                    label="Operations"
                    open={openGroups.operations}
                    onOpenChange={(open) => updateGroupOpen('operations', open)}
                />
                <NavMain
                    items={managementNavItems}
                    label="Management"
                    open={openGroups.management}
                    onOpenChange={(open) => updateGroupOpen('management', open)}
                />
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
