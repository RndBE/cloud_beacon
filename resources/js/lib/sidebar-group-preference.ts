export const SIDEBAR_GROUP_IDS = [
    'overview',
    'monitoring',
    'production',
    'operations',
    'management',
] as const;

export type SidebarGroupId = (typeof SIDEBAR_GROUP_IDS)[number];

export type SidebarGroupState = Record<SidebarGroupId, boolean>;

export const DEFAULT_SIDEBAR_GROUP_STATE: SidebarGroupState = {
    overview: true,
    monitoring: true,
    production: true,
    operations: true,
    management: true,
};

const STORAGE_KEY = 'cloud-beacon.sidebar-groups';

interface SidebarGroupStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function isSidebarGroupState(value: unknown): value is SidebarGroupState {
    if (typeof value !== 'object' || value === null) return false;

    const candidate = value as Record<string, unknown>;
    return SIDEBAR_GROUP_IDS.every(
        (groupId) => typeof candidate[groupId] === 'boolean',
    );
}

export function readStoredSidebarGroups(
    storage?: SidebarGroupStorage | null,
): SidebarGroupState {
    try {
        const target =
            storage ??
            (typeof window === 'undefined' ? null : window.localStorage);
        const stored = target?.getItem(STORAGE_KEY);
        if (!stored) return { ...DEFAULT_SIDEBAR_GROUP_STATE };

        const parsed: unknown = JSON.parse(stored);
        return isSidebarGroupState(parsed)
            ? { ...parsed }
            : { ...DEFAULT_SIDEBAR_GROUP_STATE };
    } catch {
        return { ...DEFAULT_SIDEBAR_GROUP_STATE };
    }
}

export function storeSidebarGroups(
    state: SidebarGroupState,
    storage?: SidebarGroupStorage | null,
): void {
    try {
        const target =
            storage ??
            (typeof window === 'undefined' ? null : window.localStorage);
        target?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Browser storage can be unavailable; the current UI state still works.
    }
}
