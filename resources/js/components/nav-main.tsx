import { Link } from '@inertiajs/react';
import { ChevronDown } from 'lucide-react';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useCurrentUrl } from '@/hooks/use-current-url';
import type { NavItem } from '@/types';

export function NavMain({
    items = [],
    label,
    open,
    onOpenChange,
}: {
    items: NavItem[];
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { isCurrentUrl } = useCurrentUrl();

    if (items.length === 0) return null;

    const isActiveGroup = items.some((item) => isCurrentUrl(item.href));
    const resolvedOpen = open || isActiveGroup;

    return (
        <Collapsible
            open={resolvedOpen}
            onOpenChange={(nextOpen) =>
                onOpenChange(isActiveGroup ? true : nextOpen)
            }
            asChild
        >
            <SidebarGroup className="px-2 py-0">
                <SidebarGroupLabel asChild>
                    <CollapsibleTrigger className="group/collapsible-trigger cursor-pointer select-none">
                        <span>{label}</span>
                        <ChevronDown className="ml-auto size-3.5 transition-transform group-data-[state=open]/collapsible-trigger:rotate-180" />
                    </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent
                    forceMount
                    className="data-[state=closed]:hidden group-data-[collapsible=icon]:!block"
                >
                    <SidebarMenu>
                        {items.map((item) => (
                            <SidebarMenuItem key={item.title}>
                                <SidebarMenuButton
                                    asChild
                                    isActive={isCurrentUrl(item.href)}
                                    tooltip={{ children: item.title }}
                                >
                                    <Link href={item.href} prefetch>
                                        {item.icon && <item.icon />}
                                        <span>{item.title}</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                </CollapsibleContent>
            </SidebarGroup>
        </Collapsible>
    );
}
