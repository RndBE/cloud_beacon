import { Head, router, useForm } from '@inertiajs/react';
import {
    Check,
    Edit2,
    Loader2,
    Plus,
    Shield,
    ShieldCheck,
    Trash2,
    Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface PermissionItem {
    id: number;
    name: string;
    displayName: string;
    group: string;
}

interface RoleItem {
    id: number;
    name: string;
    displayName: string;
    description: string | null;
    usersCount: number;
    permissions: PermissionItem[];
}

interface RolesPageProps {
    roles: RoleItem[];
    allPermissions: PermissionItem[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Roles', href: '/roles' },
];

export default function RolesIndex({ roles, allPermissions }: RolesPageProps) {
    const { t } = useTranslation();
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<RoleItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RoleItem | null>(null);

    const permissionsByGroup = useMemo(() => {
        const groups: Record<string, PermissionItem[]> = {};
        allPermissions.forEach((p) => {
            if (!groups[p.group]) groups[p.group] = [];
            groups[p.group].push(p);
        });
        return groups;
    }, [allPermissions]);

    const createForm = useForm({
        name: '',
        display_name: '',
        description: '',
        permissions: [] as number[],
    });

    const editForm = useForm({
        display_name: '',
        description: '',
        permissions: [] as number[],
    });

    function openEdit(role: RoleItem) {
        editForm.setData({
            display_name: role.displayName,
            description: role.description || '',
            permissions: role.permissions.map((p) => p.id),
        });
        setEditTarget(role);
    }

    function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        createForm.post('/roles', {
            onSuccess: () => {
                setAddOpen(false);
                createForm.reset();
            },
        });
    }

    function handleEdit(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.put(`/roles/${editTarget.id}`, {
            onSuccess: () => {
                setEditTarget(null);
                editForm.reset();
            },
        });
    }

    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/roles/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    function togglePermission(
        formData: { permissions: number[] },
        setData: (key: 'permissions', value: number[]) => void,
        permId: number,
    ) {
        const current = formData.permissions;
        if (current.includes(permId)) {
            setData('permissions', current.filter((id) => id !== permId));
        } else {
            setData('permissions', [...current, permId]);
        }
    }

    function PermissionGrid({
        selected,
        onChange,
    }: {
        selected: number[];
        onChange: (permId: number) => void;
    }) {
        return (
            <div className="grid gap-4 max-h-[360px] overflow-y-auto pr-2">
                {Object.entries(permissionsByGroup).map(([group, perms]) => (
                    <div key={group}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {group}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {perms.map((p) => (
                                <label
                                    key={p.id}
                                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
                                >
                                    <Checkbox
                                        checked={selected.includes(p.id)}
                                        onCheckedChange={() => onChange(p.id)}
                                    />
                                    <span>{p.displayName}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('roles.title')} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Summary */}
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                            <Shield className="size-5 text-violet-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{roles.length}</p>
                            <p className="text-xs text-muted-foreground">{t('roles.total_roles')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                            <ShieldCheck className="size-5 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{allPermissions.length}</p>
                            <p className="text-xs text-muted-foreground">{t('roles.total_permissions')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Users className="size-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {roles.reduce((sum, r) => sum + r.usersCount, 0)}
                            </p>
                            <p className="text-xs text-muted-foreground">{t('roles.assigned_users')}</p>
                        </div>
                    </div>
                </div>

                {/* Roles Grid */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">{t('roles.roles')}</h2>
                        <p className="text-sm text-muted-foreground">
                            {t('roles.manage_roles_desc')}
                        </p>
                    </div>
                    <Dialog open={addOpen} onOpenChange={setAddOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-1.5">
                                <Plus className="size-4" />
                                {t('roles.add_role')}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-lg">
                            <DialogHeader>
                                <DialogTitle>{t('roles.create_new_role')}</DialogTitle>
                                <DialogDescription>
                                    {t('roles.create_role_desc')}
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleCreate} className="grid gap-4 py-2">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label htmlFor="name">{t('roles.slug')} *</Label>
                                        <Input
                                            id="name"
                                            value={createForm.data.name}
                                            onChange={(e) =>
                                                createForm.setData('name', e.target.value)
                                            }
                                            placeholder="e.g. manager"
                                        />
                                        {createForm.errors.name && (
                                            <p className="text-xs text-red-500">
                                                {createForm.errors.name}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="display_name">{t('roles.display_name')} *</Label>
                                        <Input
                                            id="display_name"
                                            value={createForm.data.display_name}
                                            onChange={(e) =>
                                                createForm.setData('display_name', e.target.value)
                                            }
                                            placeholder="e.g. Manager"
                                        />
                                        {createForm.errors.display_name && (
                                            <p className="text-xs text-red-500">
                                                {createForm.errors.display_name}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="description">{t('roles.description')}</Label>
                                    <Textarea
                                        id="description"
                                        value={createForm.data.description}
                                        onChange={(e) =>
                                            createForm.setData('description', e.target.value)
                                        }
                                        placeholder="What this role does…"
                                        rows={2}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>{t('roles.permissions')}</Label>
                                    <PermissionGrid
                                        selected={createForm.data.permissions}
                                        onChange={(id) =>
                                            togglePermission(
                                                createForm.data,
                                                createForm.setData,
                                                id,
                                            )
                                        }
                                    />
                                </div>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setAddOpen(false)}
                                    >
                                        {t('common.cancel')}
                                    </Button>
                                    <Button type="submit" disabled={createForm.processing}>
                                        {createForm.processing ? t('roles.creating') : t('roles.create_role')}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {roles.map((role) => (
                        <Card key={role.id} className="relative">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${role.name === 'superadmin' ? 'bg-amber-500/10' : 'bg-violet-500/10'}`}>
                                            <Shield className={`size-4 ${role.name === 'superadmin' ? 'text-amber-500' : 'text-violet-500'}`} />
                                        </div>
                                        <div>
                                            <CardTitle className="text-base">
                                                {role.displayName}
                                            </CardTitle>
                                            <CardDescription className="text-xs">
                                                {role.name}
                                            </CardDescription>
                                        </div>
                                    </div>
                                    {role.name !== 'superadmin' && (
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openEdit(role)}
                                            >
                                                <Edit2 className="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                onClick={() => setDeleteTarget(role)}
                                                disabled={role.usersCount > 0}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                {role.description && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {role.description}
                                    </p>
                                )}
                            </CardHeader>
                            <Separator />
                            <CardContent className="pt-3">
                                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Users className="size-3" />
                                        {role.usersCount} user{role.usersCount !== 1 ? 's' : ''}
                                    </span>
                                    <span>
                                        {role.name === 'superadmin' ? 'All' : role.permissions.length} {t('roles.permissions').toLowerCase()}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {role.name === 'superadmin' ? (
                                        <Badge variant="default" className="gap-1 bg-amber-500/80">
                                            <ShieldCheck className="size-3" />
                                            {t('roles.all_permissions')}
                                        </Badge>
                                    ) : (
                                        role.permissions.slice(0, 6).map((p) => (
                                            <Badge
                                                key={p.id}
                                                variant="secondary"
                                                className="text-[10px]"
                                            >
                                                {p.displayName}
                                            </Badge>
                                        ))
                                    )}
                                    {role.name !== 'superadmin' && role.permissions.length > 6 && (
                                        <Badge variant="outline" className="text-[10px]">
                                            +{role.permissions.length - 6} {t('roles.more_permissions', { count: role.permissions.length - 6 }).replace(`+${role.permissions.length - 6} `, '')}
                                        </Badge>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Edit Dialog */}
                <Dialog
                    open={!!editTarget}
                    onOpenChange={(open) => {
                        if (!open) setEditTarget(null);
                    }}
                >
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Edit Role: {editTarget?.displayName}</DialogTitle>
                            <DialogDescription>
                                Update role details and permissions.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEdit} className="grid gap-4 py-2">
                            <div className="grid gap-2">
                                <Label htmlFor="edit_display_name">{t('roles.display_name')} *</Label>
                                <Input
                                    id="edit_display_name"
                                    value={editForm.data.display_name}
                                    onChange={(e) =>
                                        editForm.setData('display_name', e.target.value)
                                    }
                                />
                                {editForm.errors.display_name && (
                                    <p className="text-xs text-red-500">
                                        {editForm.errors.display_name}
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit_description">{t('roles.description')}</Label>
                                <Textarea
                                    id="edit_description"
                                    value={editForm.data.description}
                                    onChange={(e) =>
                                        editForm.setData('description', e.target.value)
                                    }
                                    rows={2}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>{t('roles.permissions')}</Label>
                                <PermissionGrid
                                    selected={editForm.data.permissions}
                                    onChange={(id) =>
                                        togglePermission(editForm.data, editForm.setData, id)
                                    }
                                />
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setEditTarget(null)}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={editForm.processing}>
                                    {editForm.processing ? t('roles.saving') : t('roles.save_changes')}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* Delete Dialog */}
                <AlertDialog
                    open={!!deleteTarget}
                    onOpenChange={(open: boolean) => {
                        if (!open) setDeleteTarget(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('roles.delete_role')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete{' '}
                                <strong>{deleteTarget?.displayName}</strong>? This action cannot be
                                undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                {t('roles.delete_role')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
