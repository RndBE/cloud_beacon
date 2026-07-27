import { Head, router, useForm, usePage } from '@inertiajs/react';
import {
    Edit2,
    Loader2,
    Plus,
    Search,
    Shield,
    ShieldCheck,
    Trash2,
    UserCog,
    UserPlus,
    Users as UsersIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface RoleItem {
    id: number;
    name: string;
    displayName: string;
}

type LoggerAccessLevel = 'view' | 'manage';
type ProjectLoggerScope = 'all' | 'selected';

interface LoggerItem {
    id: number;
    name: string;
    serialNumber: string | null;
    projectId: number | null;
    projectName?: string | null;
    projectColor?: string | null;
}

interface AssignedLoggerItem extends LoggerItem {
    accessLevel: LoggerAccessLevel;
}

interface ProjectItem {
    id: number;
    name: string;
    color: string | null;
    loggers: LoggerItem[];
}

interface AssignedProjectItem {
    id: number;
    accessLevel: LoggerAccessLevel;
    loggerScope: ProjectLoggerScope;
    loggerIds: number[];
}

type ProjectAccessValue = Record<
    string,
    {
        access_level: LoggerAccessLevel;
        logger_scope: ProjectLoggerScope;
        logger_ids: number[];
    }
>;

interface UserItem {
    id: number;
    name: string;
    email: string;
    instansi: string | null;
    createdAt: string | null;
    roles: RoleItem[];
    assignedLoggers: AssignedLoggerItem[];
    assignedProjects: AssignedProjectItem[];
}

interface UsersPageProps {
    users: UserItem[];
    allRoles: RoleItem[];
    allLoggers: LoggerItem[];
    allProjects: ProjectItem[];
    flash?: {
        success?: string;
        error?: string;
    };
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Users', href: '/users' },
];

const projectAccessLevelMeta: Record<
    LoggerAccessLevel,
    { label: string; description: string }
> = {
    view: {
        label: 'Lihat',
        description: 'User hanya dapat melihat data logger.',
    },
    manage: {
        label: 'Kelola',
        description: 'User dapat mengelola data dan akses logger.',
    },
};

function RolePicker({
    roles,
    selected,
    onChange,
}: {
    roles: RoleItem[];
    selected: number[];
    onChange: (roleId: number) => void;
}) {
    return (
        <div className="grid max-h-[200px] gap-2 overflow-y-auto pr-1">
            {roles.map((role) => (
                <label
                    key={role.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-accent"
                >
                    <Checkbox
                        checked={selected.includes(role.id)}
                        onCheckedChange={() => onChange(role.id)}
                    />
                    <div>
                        <span className="text-sm font-medium">
                            {role.displayName}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                            ({role.name})
                        </span>
                    </div>
                </label>
            ))}
        </div>
    );
}

function LoggerAccessPicker({
    loggers,
    selected,
    onToggle,
    onLevelChange,
}: {
    loggers: LoggerItem[];
    selected: Record<string, LoggerAccessLevel>;
    onToggle: (loggerId: number) => void;
    onLevelChange: (loggerId: number, accessLevel: LoggerAccessLevel) => void;
}) {
    if (loggers.length === 0) {
        return (
            <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No loggers available.
            </div>
        );
    }

    return (
        <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 lg:max-h-[52vh]">
            {loggers.map((logger) => {
                const key = logger.id.toString();
                const isSelected = Boolean(selected[key]);

                return (
                    <label
                        key={logger.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-accent"
                    >
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => onToggle(logger.id)}
                        />
                        <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                                {logger.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {logger.serialNumber || '-'}
                            </span>
                        </div>
                        <select
                            value={selected[key] ?? 'view'}
                            disabled={!isSelected}
                            onChange={(event) =>
                                onLevelChange(
                                    logger.id,
                                    event.target.value as LoggerAccessLevel,
                                )
                            }
                            className="h-9 rounded-md border bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <option value="view">View</option>
                            <option value="manage">Manage</option>
                        </select>
                    </label>
                );
            })}
        </div>
    );
}

function ProjectAccessPicker({
    projects,
    directLoggers,
    projectAccess,
    loggerAccess,
    onToggleProject,
    onProjectLevelChange,
    onProjectScopeChange,
    onToggleProjectLogger,
    onToggleLogger,
    onLoggerLevelChange,
}: {
    projects: ProjectItem[];
    directLoggers: LoggerItem[];
    projectAccess: ProjectAccessValue;
    loggerAccess: Record<string, LoggerAccessLevel>;
    onToggleProject: (projectId: number) => void;
    onProjectLevelChange: (
        projectId: number,
        accessLevel: LoggerAccessLevel,
    ) => void;
    onProjectScopeChange: (
        projectId: number,
        loggerScope: ProjectLoggerScope,
    ) => void;
    onToggleProjectLogger: (projectId: number, loggerId: number) => void;
    onToggleLogger: (loggerId: number) => void;
    onLoggerLevelChange: (
        loggerId: number,
        accessLevel: LoggerAccessLevel,
    ) => void;
}) {
    if (projects.length === 0 && directLoggers.length === 0) {
        return (
            <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No projects or loggers available.
            </div>
        );
    }

    return (
        <div className="grid max-h-[420px] content-start gap-2 overflow-y-auto pr-1 lg:max-h-[52vh]">
            {projects.map((project) => {
                const key = project.id.toString();
                const access = projectAccess[key];
                const isSelected = Boolean(access);
                const selectedLoggerIds = access?.logger_ids ?? [];
                const accessMeta = access
                    ? projectAccessLevelMeta[access.access_level]
                    : null;

                return (
                    <div
                        key={project.id}
                        className="rounded-md border px-3 py-2 transition-colors hover:bg-accent/40"
                    >
                        <div className="flex items-center gap-3">
                            <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                    onToggleProject(project.id)
                                }
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span
                                        className="size-2.5 rounded-full"
                                        style={{
                                            backgroundColor:
                                                project.color || '#94a3b8',
                                        }}
                                    />
                                    <span className="truncate text-sm font-medium">
                                        {project.name}
                                    </span>
                                </div>
                                <p className="text-xs leading-tight text-muted-foreground">
                                    {project.loggers.length} logger
                                </p>
                            </div>
                        </div>

                        {isSelected && (
                            <div className="mt-3 grid gap-3 pl-7">
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <label className="grid gap-1 text-xs font-medium">
                                        <span className="text-muted-foreground">
                                            Hak akses
                                        </span>
                                        <Select
                                            value={access.access_level}
                                            onValueChange={(value) =>
                                                onProjectLevelChange(
                                                    project.id,
                                                    value as LoggerAccessLevel,
                                                )
                                            }
                                        >
                                            <SelectTrigger className="h-10 rounded-lg border-border/70 bg-background/90 font-semibold shadow-sm dark:bg-input/40">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent position="popper">
                                                <SelectItem value="view">
                                                    {
                                                        projectAccessLevelMeta
                                                            .view.label
                                                    }
                                                </SelectItem>
                                                <SelectItem value="manage">
                                                    {
                                                        projectAccessLevelMeta
                                                            .manage.label
                                                    }
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {accessMeta && (
                                            <span className="text-[11px] leading-snug text-muted-foreground">
                                                {accessMeta.description}
                                            </span>
                                        )}
                                    </label>
                                    <label className="grid gap-1 text-xs font-medium">
                                        <span className="text-muted-foreground">
                                            Cakupan logger
                                        </span>
                                        <Select
                                            value={access.logger_scope}
                                            onValueChange={(value) =>
                                                onProjectScopeChange(
                                                    project.id,
                                                    value as ProjectLoggerScope,
                                                )
                                            }
                                        >
                                            <SelectTrigger className="h-10 rounded-lg border-border/70 bg-background/90 font-semibold shadow-sm dark:bg-input/40">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent position="popper">
                                                <SelectItem value="all">
                                                    Semua logger
                                                </SelectItem>
                                                <SelectItem value="selected">
                                                    Pilih logger tertentu
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <span className="text-[11px] leading-snug text-muted-foreground">
                                            {access.logger_scope === 'selected'
                                                ? `${selectedLoggerIds.length} dari ${project.loggers.length} logger dipilih`
                                                : 'Semua logger di project ini otomatis tercakup.'}
                                        </span>
                                    </label>
                                </div>

                                {access.logger_scope === 'all' ? (
                                    <p className="rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                                        Semua logger di project ini otomatis
                                        tercakup untuk user.
                                    </p>
                                ) : project.loggers.length === 0 ? (
                                    <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                                        Belum ada logger di project ini.
                                    </p>
                                ) : (
                                    <div className="grid gap-2">
                                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                            <span>
                                                Pilih logger yang boleh diakses
                                            </span>
                                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5">
                                                {selectedLoggerIds.length}/
                                                {project.loggers.length} dipilih
                                            </span>
                                        </div>
                                        {project.loggers.map((logger) => (
                                            <label
                                                key={logger.id}
                                                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-accent"
                                            >
                                                <Checkbox
                                                    checked={selectedLoggerIds.includes(
                                                        logger.id,
                                                    )}
                                                    onCheckedChange={() =>
                                                        onToggleProjectLogger(
                                                            project.id,
                                                            logger.id,
                                                        )
                                                    }
                                                />
                                                <span className="min-w-0 flex-1 truncate text-sm">
                                                    {logger.name}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {logger.serialNumber || '-'}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {directLoggers.length > 0 && (
                <>
                    <Separator />
                    <div className="grid gap-2">
                        <Label>Logger Tanpa Project</Label>
                        <LoggerAccessPicker
                            loggers={directLoggers}
                            selected={loggerAccess}
                            onToggle={onToggleLogger}
                            onLevelChange={onLoggerLevelChange}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

export default function UsersIndex({
    users,
    allRoles,
    allLoggers,
    allProjects,
}: UsersPageProps) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>()
        .props;
    const [search, setSearch] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<UserItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
    const [flashMsg, setFlashMsg] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    useEffect(() => {
        const nextFlash = flash?.success
            ? { type: 'success' as const, text: flash.success }
            : flash?.error
              ? { type: 'error' as const, text: flash.error }
              : null;

        if (nextFlash) {
            const showTimer = window.setTimeout(
                () => setFlashMsg(nextFlash),
                0,
            );
            const hideTimer = window.setTimeout(() => setFlashMsg(null), 5000);

            return () => {
                window.clearTimeout(showTimer);
                window.clearTimeout(hideTimer);
            };
        }
    }, [flash]);

    const createForm = useForm({
        name: '',
        email: '',
        instansi: '',
        password: '',
        password_confirmation: '',
        roles: [] as number[],
        logger_access: {} as Record<string, LoggerAccessLevel>,
        project_access: {} as ProjectAccessValue,
    });

    const editForm = useForm({
        name: '',
        email: '',
        instansi: '',
        password: '',
        password_confirmation: '',
        roles: [] as number[],
        logger_access: {} as Record<string, LoggerAccessLevel>,
        project_access: {} as ProjectAccessValue,
    });

    const directLoggers = useMemo(
        () => allLoggers.filter((logger) => logger.projectId === null),
        [allLoggers],
    );

    const filtered = useMemo(() => {
        if (!search) return users;
        const q = search.toLowerCase();
        return users.filter(
            (u) =>
                u.name.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q) ||
                (u.instansi && u.instansi.toLowerCase().includes(q)) ||
                u.roles.some((r) => r.displayName.toLowerCase().includes(q)),
        );
    }, [users, search]);

    // ─── Create ──────────────────────────────────────────
    function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        createForm.post('/users', {
            onSuccess: () => {
                setAddOpen(false);
                createForm.reset();
            },
        });
    }

    // ─── Edit ────────────────────────────────────────────
    function openEdit(user: UserItem) {
        editForm.setData({
            name: user.name,
            email: user.email,
            instansi: user.instansi || '',
            password: '',
            password_confirmation: '',
            roles: user.roles.map((r) => r.id),
            logger_access: Object.fromEntries(
                user.assignedLoggers
                    .filter((logger) => logger.projectId === null)
                    .map((logger) => [
                        logger.id.toString(),
                        logger.accessLevel,
                    ]),
            ),
            project_access: buildProjectAccessFromUser(user),
        });
        editForm.clearErrors();
        setEditTarget(user);
    }

    function handleEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.put(`/users/${editTarget.id}`, {
            onSuccess: () => {
                setEditTarget(null);
                editForm.reset();
            },
        });
    }

    // ─── Delete ──────────────────────────────────────────
    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/users/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    // ─── Role toggle helper ──────────────────────────────
    function toggleRole(
        formData: { roles: number[] },
        setData: (key: 'roles', value: number[]) => void,
        roleId: number,
    ) {
        const current = formData.roles;
        if (current.includes(roleId)) {
            setData(
                'roles',
                current.filter((id) => id !== roleId),
            );
        } else {
            setData('roles', [...current, roleId]);
        }
    }

    function toggleLoggerAccess(
        current: Record<string, LoggerAccessLevel>,
        setData: (
            key: 'logger_access',
            value: Record<string, LoggerAccessLevel>,
        ) => void,
        loggerId: number,
    ) {
        const key = loggerId.toString();
        const next = { ...current };

        if (next[key]) {
            delete next[key];
        } else {
            next[key] = 'view';
        }

        setData('logger_access', next);
    }

    function setLoggerAccessLevel(
        current: Record<string, LoggerAccessLevel>,
        setData: (
            key: 'logger_access',
            value: Record<string, LoggerAccessLevel>,
        ) => void,
        loggerId: number,
        accessLevel: LoggerAccessLevel,
    ) {
        setData('logger_access', {
            ...current,
            [loggerId.toString()]: accessLevel,
        });
    }

    function buildProjectAccessFromUser(user: UserItem): ProjectAccessValue {
        const projectAccess: ProjectAccessValue = Object.fromEntries(
            user.assignedProjects.map((project) => [
                project.id.toString(),
                {
                    access_level: project.accessLevel,
                    logger_scope: project.loggerScope,
                    logger_ids: project.loggerIds,
                },
            ]),
        );

        user.assignedLoggers
            .filter((logger) => logger.projectId !== null)
            .forEach((logger) => {
                const projectKey = logger.projectId?.toString();
                if (!projectKey) return;

                if (!projectAccess[projectKey]) {
                    projectAccess[projectKey] = {
                        access_level: logger.accessLevel,
                        logger_scope: 'selected',
                        logger_ids: [],
                    };
                }

                if (!projectAccess[projectKey].logger_ids.includes(logger.id)) {
                    projectAccess[projectKey].logger_ids.push(logger.id);
                }

                if (logger.accessLevel === 'manage') {
                    projectAccess[projectKey].access_level = 'manage';
                }
            });

        return projectAccess;
    }

    function toggleProjectAccess(
        current: ProjectAccessValue,
        setData: (key: 'project_access', value: ProjectAccessValue) => void,
        projectId: number,
    ) {
        const key = projectId.toString();
        const next = { ...current };

        if (next[key]) {
            delete next[key];
        } else {
            next[key] = {
                access_level: 'view',
                logger_scope: 'all',
                logger_ids: [],
            };
        }

        setData('project_access', next);
    }

    function setProjectAccessLevel(
        current: ProjectAccessValue,
        setData: (key: 'project_access', value: ProjectAccessValue) => void,
        projectId: number,
        accessLevel: LoggerAccessLevel,
    ) {
        const key = projectId.toString();
        const existing = current[key];
        if (!existing) return;

        setData('project_access', {
            ...current,
            [key]: {
                ...existing,
                access_level: accessLevel,
            },
        });
    }

    function setProjectLoggerScope(
        current: ProjectAccessValue,
        setData: (key: 'project_access', value: ProjectAccessValue) => void,
        projectId: number,
        loggerScope: ProjectLoggerScope,
    ) {
        const key = projectId.toString();
        const existing = current[key];
        if (!existing) return;

        setData('project_access', {
            ...current,
            [key]: {
                ...existing,
                logger_scope: loggerScope,
                logger_ids:
                    loggerScope === 'all' ? [] : (existing.logger_ids ?? []),
            },
        });
    }

    function toggleProjectLogger(
        current: ProjectAccessValue,
        setData: (key: 'project_access', value: ProjectAccessValue) => void,
        projectId: number,
        loggerId: number,
    ) {
        const key = projectId.toString();
        const existing = current[key];
        if (!existing) return;

        const loggerIds = existing.logger_ids.includes(loggerId)
            ? existing.logger_ids.filter((id) => id !== loggerId)
            : [...existing.logger_ids, loggerId];

        setData('project_access', {
            ...current,
            [key]: {
                ...existing,
                logger_scope: 'selected',
                logger_ids: loggerIds,
            },
        });
    }

    // ─── Role Picker ─────────────────────────────────────
    // ─── Stats ───────────────────────────────────────────
    const totalUsers = users.length;
    const usersWithRoles = users.filter((u) => u.roles.length > 0).length;
    const superadminCount = users.filter((u) =>
        u.roles.some((r) => r.name === 'superadmin'),
    ).length;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('users.title')} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Flash Message */}
                {flashMsg && (
                    <div
                        className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
                            flashMsg.type === 'success'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                        }`}
                    >
                        <span>{flashMsg.text}</span>
                        <button
                            onClick={() => setFlashMsg(null)}
                            className="ml-auto text-xs opacity-60 hover:opacity-100"
                        >
                            ✕
                        </button>
                    </div>
                )}

                {/* Summary Cards */}
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                            <UsersIcon className="size-5 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{totalUsers}</p>
                            <p className="text-xs text-muted-foreground">
                                {t('users.total_users')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Shield className="size-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {usersWithRoles}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t('users.users_with_roles')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                            <ShieldCheck className="size-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {superadminCount}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t('users.super_admins')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Users Table */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <UserCog className="size-5" />
                                    User Management
                                </CardTitle>
                                <CardDescription>
                                    {t('users.of_users', {
                                        filtered: filtered.length,
                                        total: users.length,
                                    })}
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <div className="relative">
                                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder={t(
                                            'users.search_placeholder',
                                        )}
                                        value={search}
                                        onChange={(e) =>
                                            setSearch(e.target.value)
                                        }
                                        className="w-full pl-9 sm:w-[240px]"
                                    />
                                </div>
                                <Dialog
                                    open={addOpen}
                                    onOpenChange={(open) => {
                                        setAddOpen(open);
                                        if (!open) createForm.reset();
                                    }}
                                >
                                    <DialogTrigger asChild>
                                        <Button className="gap-1.5">
                                            <Plus className="size-4" />
                                            {t('users.add_user')}
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
                                        <DialogHeader>
                                            <DialogTitle className="flex items-center gap-2">
                                                <UserPlus className="size-5" />
                                                {t('users.create_new_user')}
                                            </DialogTitle>
                                            <DialogDescription>
                                                {t('users.create_user_desc')}
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form
                                            onSubmit={handleCreate}
                                            className="grid gap-4 py-2"
                                        >
                                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                                                <div className="grid gap-4">
                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="create_name">
                                                                {t(
                                                                    'users.name',
                                                                )}{' '}
                                                                *
                                                            </Label>
                                                            <Input
                                                                id="create_name"
                                                                value={
                                                                    createForm
                                                                        .data
                                                                        .name
                                                                }
                                                                onChange={(e) =>
                                                                    createForm.setData(
                                                                        'name',
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder={t(
                                                                    'users.full_name',
                                                                )}
                                                            />
                                                            {createForm.errors
                                                                .name && (
                                                                <p className="text-xs text-red-500">
                                                                    {
                                                                        createForm
                                                                            .errors
                                                                            .name
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="create_email">
                                                                {t(
                                                                    'users.email',
                                                                )}{' '}
                                                                *
                                                            </Label>
                                                            <Input
                                                                id="create_email"
                                                                type="email"
                                                                value={
                                                                    createForm
                                                                        .data
                                                                        .email
                                                                }
                                                                onChange={(e) =>
                                                                    createForm.setData(
                                                                        'email',
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder="user@example.com"
                                                            />
                                                            {createForm.errors
                                                                .email && (
                                                                <p className="text-xs text-red-500">
                                                                    {
                                                                        createForm
                                                                            .errors
                                                                            .email
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label htmlFor="create_instansi">
                                                            {t(
                                                                'users.instansi',
                                                            )}
                                                        </Label>
                                                        <Input
                                                            id="create_instansi"
                                                            value={
                                                                createForm.data
                                                                    .instansi
                                                            }
                                                            onChange={(e) =>
                                                                createForm.setData(
                                                                    'instansi',
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            placeholder={t(
                                                                'users.instansi_placeholder',
                                                            )}
                                                        />
                                                        {createForm.errors
                                                            .instansi && (
                                                            <p className="text-xs text-red-500">
                                                                {
                                                                    createForm
                                                                        .errors
                                                                        .instansi
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="create_password">
                                                                {t(
                                                                    'users.password',
                                                                )}{' '}
                                                                *
                                                            </Label>
                                                            <Input
                                                                id="create_password"
                                                                type="password"
                                                                value={
                                                                    createForm
                                                                        .data
                                                                        .password
                                                                }
                                                                onChange={(e) =>
                                                                    createForm.setData(
                                                                        'password',
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder={t(
                                                                    'users.min_8_chars',
                                                                )}
                                                            />
                                                            {createForm.errors
                                                                .password && (
                                                                <p className="text-xs text-red-500">
                                                                    {
                                                                        createForm
                                                                            .errors
                                                                            .password
                                                                    }
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="grid gap-2">
                                                            <Label htmlFor="create_password_confirmation">
                                                                {t(
                                                                    'users.confirm_password',
                                                                )}{' '}
                                                                *
                                                            </Label>
                                                            <Input
                                                                id="create_password_confirmation"
                                                                type="password"
                                                                value={
                                                                    createForm
                                                                        .data
                                                                        .password_confirmation
                                                                }
                                                                onChange={(e) =>
                                                                    createForm.setData(
                                                                        'password_confirmation',
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder={t(
                                                                    'users.confirm_password_placeholder',
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-2">
                                                        <Label>
                                                            {t(
                                                                'users.assign_roles',
                                                            )}
                                                        </Label>
                                                        <RolePicker
                                                            roles={allRoles}
                                                            selected={
                                                                createForm.data
                                                                    .roles
                                                            }
                                                            onChange={(id) =>
                                                                toggleRole(
                                                                    createForm.data,
                                                                    createForm.setData,
                                                                    id,
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid content-start gap-2 self-start rounded-lg border bg-muted/20 p-4">
                                                    <Label>
                                                        Project & Logger Access
                                                    </Label>
                                                    <ProjectAccessPicker
                                                        projects={allProjects}
                                                        directLoggers={
                                                            directLoggers
                                                        }
                                                        projectAccess={
                                                            createForm.data
                                                                .project_access
                                                        }
                                                        loggerAccess={
                                                            createForm.data
                                                                .logger_access
                                                        }
                                                        onToggleProject={(id) =>
                                                            toggleProjectAccess(
                                                                createForm.data
                                                                    .project_access,
                                                                createForm.setData,
                                                                id,
                                                            )
                                                        }
                                                        onProjectLevelChange={(
                                                            id,
                                                            level,
                                                        ) =>
                                                            setProjectAccessLevel(
                                                                createForm.data
                                                                    .project_access,
                                                                createForm.setData,
                                                                id,
                                                                level,
                                                            )
                                                        }
                                                        onProjectScopeChange={(
                                                            id,
                                                            scope,
                                                        ) =>
                                                            setProjectLoggerScope(
                                                                createForm.data
                                                                    .project_access,
                                                                createForm.setData,
                                                                id,
                                                                scope,
                                                            )
                                                        }
                                                        onToggleProjectLogger={(
                                                            projectId,
                                                            loggerId,
                                                        ) =>
                                                            toggleProjectLogger(
                                                                createForm.data
                                                                    .project_access,
                                                                createForm.setData,
                                                                projectId,
                                                                loggerId,
                                                            )
                                                        }
                                                        onToggleLogger={(id) =>
                                                            toggleLoggerAccess(
                                                                createForm.data
                                                                    .logger_access,
                                                                createForm.setData,
                                                                id,
                                                            )
                                                        }
                                                        onLoggerLevelChange={(
                                                            id,
                                                            level,
                                                        ) =>
                                                            setLoggerAccessLevel(
                                                                createForm.data
                                                                    .logger_access,
                                                                createForm.setData,
                                                                id,
                                                                level,
                                                            )
                                                        }
                                                    />
                                                    {createForm.errors
                                                        .logger_access && (
                                                        <p className="text-xs text-red-500">
                                                            {
                                                                createForm
                                                                    .errors
                                                                    .logger_access
                                                            }
                                                        </p>
                                                    )}
                                                    {createForm.errors
                                                        .project_access && (
                                                        <p className="text-xs text-red-500">
                                                            {
                                                                createForm
                                                                    .errors
                                                                    .project_access
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() =>
                                                        setAddOpen(false)
                                                    }
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="submit"
                                                    disabled={
                                                        createForm.processing
                                                    }
                                                >
                                                    {createForm.processing ? (
                                                        <>
                                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                                            Creating…
                                                        </>
                                                    ) : (
                                                        'Create User'
                                                    )}
                                                </Button>
                                            </DialogFooter>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('users.name')}</TableHead>
                                    <TableHead>{t('users.email')}</TableHead>
                                    <TableHead>{t('users.instansi')}</TableHead>
                                    <TableHead>{t('users.roles')}</TableHead>
                                    <TableHead className="hidden md:table-cell">
                                        {t('users.joined')}
                                    </TableHead>
                                    <TableHead className="w-[100px]">
                                        {t('users.actions')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">
                                            {user.name}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {user.email}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {user.instansi || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {user.roles.length === 0 ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs text-muted-foreground"
                                                    >
                                                        {t('users.no_role')}
                                                    </Badge>
                                                ) : (
                                                    user.roles.map((r) => (
                                                        <Badge
                                                            key={r.id}
                                                            variant={
                                                                r.name ===
                                                                'superadmin'
                                                                    ? 'default'
                                                                    : 'secondary'
                                                            }
                                                            className={
                                                                r.name ===
                                                                'superadmin'
                                                                    ? 'bg-amber-500/80 text-xs'
                                                                    : 'text-xs'
                                                            }
                                                        >
                                                            {r.displayName}
                                                        </Badge>
                                                    ))
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                                            {user.createdAt || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        openEdit(user)
                                                    }
                                                    title="Edit user"
                                                >
                                                    <Edit2 className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                                    onClick={() =>
                                                        setDeleteTarget(user)
                                                    }
                                                    title="Delete user"
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filtered.length === 0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={5}
                                            className="py-12 text-center text-muted-foreground"
                                        >
                                            {t('users.no_users_found')}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* ─── Edit User Dialog ─────────────────────────── */}
                <Dialog
                    open={!!editTarget}
                    onOpenChange={(open) => {
                        if (!open) {
                            setEditTarget(null);
                            editForm.reset();
                        }
                    }}
                >
                    <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Edit2 className="size-5" />
                                Edit User: {editTarget?.name}
                            </DialogTitle>
                            <DialogDescription>
                                Update user details and role assignments. Leave
                                password empty to keep unchanged.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEdit} className="grid gap-4 py-2">
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                                <div className="grid gap-4">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label htmlFor="edit_name">
                                                {t('users.name')} *
                                            </Label>
                                            <Input
                                                id="edit_name"
                                                value={editForm.data.name}
                                                onChange={(e) =>
                                                    editForm.setData(
                                                        'name',
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                            {editForm.errors.name && (
                                                <p className="text-xs text-red-500">
                                                    {editForm.errors.name}
                                                </p>
                                            )}
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="edit_email">
                                                {t('users.email')} *
                                            </Label>
                                            <Input
                                                id="edit_email"
                                                type="email"
                                                value={editForm.data.email}
                                                onChange={(e) =>
                                                    editForm.setData(
                                                        'email',
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                            {editForm.errors.email && (
                                                <p className="text-xs text-red-500">
                                                    {editForm.errors.email}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="edit_instansi">
                                            {t('users.instansi')}
                                        </Label>
                                        <Input
                                            id="edit_instansi"
                                            value={editForm.data.instansi}
                                            onChange={(e) =>
                                                editForm.setData(
                                                    'instansi',
                                                    e.target.value,
                                                )
                                            }
                                            placeholder={t(
                                                'users.instansi_placeholder',
                                            )}
                                        />
                                        {editForm.errors.instansi && (
                                            <p className="text-xs text-red-500">
                                                {editForm.errors.instansi}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="grid gap-2">
                                            <Label htmlFor="edit_password">
                                                {t('users.new_password')}
                                            </Label>
                                            <Input
                                                id="edit_password"
                                                type="password"
                                                value={editForm.data.password}
                                                onChange={(e) =>
                                                    editForm.setData(
                                                        'password',
                                                        e.target.value,
                                                    )
                                                }
                                                placeholder={t(
                                                    'users.leave_empty',
                                                )}
                                            />
                                            {editForm.errors.password && (
                                                <p className="text-xs text-red-500">
                                                    {editForm.errors.password}
                                                </p>
                                            )}
                                        </div>
                                        <div className="grid gap-2">
                                            <Label htmlFor="edit_password_confirmation">
                                                {t('users.confirm_password')}
                                            </Label>
                                            <Input
                                                id="edit_password_confirmation"
                                                type="password"
                                                value={
                                                    editForm.data
                                                        .password_confirmation
                                                }
                                                onChange={(e) =>
                                                    editForm.setData(
                                                        'password_confirmation',
                                                        e.target.value,
                                                    )
                                                }
                                                placeholder={t(
                                                    'users.confirm_new_password',
                                                )}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>{t('users.assign_roles')}</Label>
                                        <RolePicker
                                            roles={allRoles}
                                            selected={editForm.data.roles}
                                            onChange={(id) =>
                                                toggleRole(
                                                    editForm.data,
                                                    editForm.setData,
                                                    id,
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="grid content-start gap-2 self-start rounded-lg border bg-muted/20 p-4">
                                    <Label>Project & Logger Access</Label>
                                    <ProjectAccessPicker
                                        projects={allProjects}
                                        directLoggers={directLoggers}
                                        projectAccess={
                                            editForm.data.project_access
                                        }
                                        loggerAccess={
                                            editForm.data.logger_access
                                        }
                                        onToggleProject={(id) =>
                                            toggleProjectAccess(
                                                editForm.data.project_access,
                                                editForm.setData,
                                                id,
                                            )
                                        }
                                        onProjectLevelChange={(id, level) =>
                                            setProjectAccessLevel(
                                                editForm.data.project_access,
                                                editForm.setData,
                                                id,
                                                level,
                                            )
                                        }
                                        onProjectScopeChange={(id, scope) =>
                                            setProjectLoggerScope(
                                                editForm.data.project_access,
                                                editForm.setData,
                                                id,
                                                scope,
                                            )
                                        }
                                        onToggleProjectLogger={(
                                            projectId,
                                            loggerId,
                                        ) =>
                                            toggleProjectLogger(
                                                editForm.data.project_access,
                                                editForm.setData,
                                                projectId,
                                                loggerId,
                                            )
                                        }
                                        onToggleLogger={(id) =>
                                            toggleLoggerAccess(
                                                editForm.data.logger_access,
                                                editForm.setData,
                                                id,
                                            )
                                        }
                                        onLoggerLevelChange={(id, level) =>
                                            setLoggerAccessLevel(
                                                editForm.data.logger_access,
                                                editForm.setData,
                                                id,
                                                level,
                                            )
                                        }
                                    />
                                    {editForm.errors.logger_access && (
                                        <p className="text-xs text-red-500">
                                            {editForm.errors.logger_access}
                                        </p>
                                    )}
                                    {editForm.errors.project_access && (
                                        <p className="text-xs text-red-500">
                                            {editForm.errors.project_access}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setEditTarget(null)}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={editForm.processing}
                                >
                                    {editForm.processing ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            {t('users.saving')}
                                        </>
                                    ) : (
                                        t('users.save_changes')
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* ─── Delete Confirmation Dialog ──────────────── */}
                <AlertDialog
                    open={!!deleteTarget}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteTarget(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {t('users.delete_user')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete{' '}
                                <strong>{deleteTarget?.name}</strong> (
                                {deleteTarget?.email})? This action cannot be
                                undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>
                                {t('common.cancel')}
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                {t('users.delete_user')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
