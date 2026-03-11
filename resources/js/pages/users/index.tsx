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

interface UserItem {
    id: number;
    name: string;
    email: string;
    createdAt: string | null;
    roles: RoleItem[];
}

interface UsersPageProps {
    users: UserItem[];
    allRoles: RoleItem[];
    flash?: {
        success?: string;
        error?: string;
    };
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Users', href: '/users' },
];

export default function UsersIndex({ users, allRoles }: UsersPageProps) {
    const { flash } = usePage<{ flash: { success?: string; error?: string } }>().props;
    const [search, setSearch] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<UserItem | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
    const [flashMsg, setFlashMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (flash?.success) {
            setFlashMsg({ type: 'success', text: flash.success });
        } else if (flash?.error) {
            setFlashMsg({ type: 'error', text: flash.error });
        }
        if (flash?.success || flash?.error) {
            const timer = setTimeout(() => setFlashMsg(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [flash]);

    const createForm = useForm({
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
        roles: [] as number[],
    });

    const editForm = useForm({
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
        roles: [] as number[],
    });

    const filtered = useMemo(() => {
        if (!search) return users;
        const q = search.toLowerCase();
        return users.filter(
            (u) =>
                u.name.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q) ||
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
            password: '',
            password_confirmation: '',
            roles: user.roles.map((r) => r.id),
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
            setData('roles', current.filter((id) => id !== roleId));
        } else {
            setData('roles', [...current, roleId]);
        }
    }

    // ─── Role Picker ─────────────────────────────────────
    function RolePicker({
        selected,
        onChange,
    }: {
        selected: number[];
        onChange: (roleId: number) => void;
    }) {
        return (
            <div className="grid gap-2 max-h-[200px] overflow-y-auto pr-1">
                {allRoles.map((role) => (
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

    // ─── Stats ───────────────────────────────────────────
    const totalUsers = users.length;
    const usersWithRoles = users.filter((u) => u.roles.length > 0).length;
    const superadminCount = users.filter((u) => u.roles.some((r) => r.name === 'superadmin')).length;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="User Management" />
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
                            <p className="text-xs text-muted-foreground">Total Users</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Shield className="size-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{usersWithRoles}</p>
                            <p className="text-xs text-muted-foreground">Users with Roles</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                            <ShieldCheck className="size-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{superadminCount}</p>
                            <p className="text-xs text-muted-foreground">Super Admins</p>
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
                                    {filtered.length} of {users.length} users
                                </CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        placeholder="Search name, email, role…"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="w-full pl-9 sm:w-[240px]"
                                    />
                                </div>
                                <Dialog open={addOpen} onOpenChange={(open) => {
                                    setAddOpen(open);
                                    if (!open) createForm.reset();
                                }}>
                                    <DialogTrigger asChild>
                                        <Button className="gap-1.5">
                                            <Plus className="size-4" />
                                            Add User
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-lg">
                                        <DialogHeader>
                                            <DialogTitle className="flex items-center gap-2">
                                                <UserPlus className="size-5" />
                                                Create New User
                                            </DialogTitle>
                                            <DialogDescription>
                                                Add a new user account and assign roles.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <form onSubmit={handleCreate} className="grid gap-4 py-2">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="create_name">Name *</Label>
                                                    <Input
                                                        id="create_name"
                                                        value={createForm.data.name}
                                                        onChange={(e) => createForm.setData('name', e.target.value)}
                                                        placeholder="Full name"
                                                    />
                                                    {createForm.errors.name && (
                                                        <p className="text-xs text-red-500">{createForm.errors.name}</p>
                                                    )}
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="create_email">Email *</Label>
                                                    <Input
                                                        id="create_email"
                                                        type="email"
                                                        value={createForm.data.email}
                                                        onChange={(e) => createForm.setData('email', e.target.value)}
                                                        placeholder="user@example.com"
                                                    />
                                                    {createForm.errors.email && (
                                                        <p className="text-xs text-red-500">{createForm.errors.email}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="create_password">Password *</Label>
                                                    <Input
                                                        id="create_password"
                                                        type="password"
                                                        value={createForm.data.password}
                                                        onChange={(e) => createForm.setData('password', e.target.value)}
                                                        placeholder="Min 8 characters"
                                                    />
                                                    {createForm.errors.password && (
                                                        <p className="text-xs text-red-500">{createForm.errors.password}</p>
                                                    )}
                                                </div>
                                                <div className="grid gap-2">
                                                    <Label htmlFor="create_password_confirmation">Confirm Password *</Label>
                                                    <Input
                                                        id="create_password_confirmation"
                                                        type="password"
                                                        value={createForm.data.password_confirmation}
                                                        onChange={(e) => createForm.setData('password_confirmation', e.target.value)}
                                                        placeholder="Confirm password"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid gap-2">
                                                <Label>Assign Roles</Label>
                                                <RolePicker
                                                    selected={createForm.data.roles}
                                                    onChange={(id) => toggleRole(createForm.data, createForm.setData, id)}
                                                />
                                            </div>
                                            <DialogFooter>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => setAddOpen(false)}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button type="submit" disabled={createForm.processing}>
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
                                    <TableHead>Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Roles</TableHead>
                                    <TableHead className="hidden md:table-cell">Joined</TableHead>
                                    <TableHead className="w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">{user.name}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {user.email}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {user.roles.length === 0 ? (
                                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                                        No role
                                                    </Badge>
                                                ) : (
                                                    user.roles.map((r) => (
                                                        <Badge
                                                            key={r.id}
                                                            variant={r.name === 'superadmin' ? 'default' : 'secondary'}
                                                            className={r.name === 'superadmin' ? 'bg-amber-500/80 text-xs' : 'text-xs'}
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
                                                    onClick={() => openEdit(user)}
                                                    title="Edit user"
                                                >
                                                    <Edit2 className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                    onClick={() => setDeleteTarget(user)}
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
                                            No users found.
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
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Edit2 className="size-5" />
                                Edit User: {editTarget?.name}
                            </DialogTitle>
                            <DialogDescription>
                                Update user details and role assignments. Leave password empty to keep unchanged.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleEdit} className="grid gap-4 py-2">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="edit_name">Name *</Label>
                                    <Input
                                        id="edit_name"
                                        value={editForm.data.name}
                                        onChange={(e) => editForm.setData('name', e.target.value)}
                                    />
                                    {editForm.errors.name && (
                                        <p className="text-xs text-red-500">{editForm.errors.name}</p>
                                    )}
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit_email">Email *</Label>
                                    <Input
                                        id="edit_email"
                                        type="email"
                                        value={editForm.data.email}
                                        onChange={(e) => editForm.setData('email', e.target.value)}
                                    />
                                    {editForm.errors.email && (
                                        <p className="text-xs text-red-500">{editForm.errors.email}</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="edit_password">New Password</Label>
                                    <Input
                                        id="edit_password"
                                        type="password"
                                        value={editForm.data.password}
                                        onChange={(e) => editForm.setData('password', e.target.value)}
                                        placeholder="Leave empty to keep"
                                    />
                                    {editForm.errors.password && (
                                        <p className="text-xs text-red-500">{editForm.errors.password}</p>
                                    )}
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit_password_confirmation">Confirm Password</Label>
                                    <Input
                                        id="edit_password_confirmation"
                                        type="password"
                                        value={editForm.data.password_confirmation}
                                        onChange={(e) => editForm.setData('password_confirmation', e.target.value)}
                                        placeholder="Confirm new password"
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label>Assign Roles</Label>
                                <RolePicker
                                    selected={editForm.data.roles}
                                    onChange={(id) => toggleRole(editForm.data, editForm.setData, id)}
                                />
                            </div>
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setEditTarget(null)}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={editForm.processing}>
                                    {editForm.processing ? (
                                        <>
                                            <Loader2 className="mr-2 size-4 animate-spin" />
                                            Saving…
                                        </>
                                    ) : (
                                        'Save Changes'
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
                            <AlertDialogTitle>Delete User</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete{' '}
                                <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email})?
                                This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDelete}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                Delete User
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
