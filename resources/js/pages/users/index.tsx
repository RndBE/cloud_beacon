import { Head, router, useForm } from '@inertiajs/react';
import {
    Edit2,
    Search,
    Shield,
    ShieldCheck,
    UserCog,
    Users as UsersIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Users', href: '/users' },
];

export default function UsersIndex({ users, allRoles }: UsersPageProps) {
    const [search, setSearch] = useState('');
    const [editTarget, setEditTarget] = useState<UserItem | null>(null);

    const editForm = useForm({
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

    function openEdit(user: UserItem) {
        editForm.setData('roles', user.roles.map((r) => r.id));
        setEditTarget(user);
    }

    function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (!editTarget) return;
        editForm.put(`/users/${editTarget.id}/roles`, {
            onSuccess: () => {
                setEditTarget(null);
                editForm.reset();
            },
        });
    }

    function toggleRole(roleId: number) {
        const current = editForm.data.roles;
        if (current.includes(roleId)) {
            editForm.setData('roles', current.filter((id) => id !== roleId));
        } else {
            editForm.setData('roles', [...current, roleId]);
        }
    }

    const totalUsers = users.length;
    const usersWithRoles = users.filter((u) => u.roles.length > 0).length;
    const superadminCount = users.filter((u) => u.roles.some((r) => r.name === 'superadmin')).length;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="User Management" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Summary */}
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
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search name, email, role…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full pl-9 sm:w-[280px]"
                                />
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
                                    <TableHead className="w-[60px]"></TableHead>
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
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openEdit(user)}
                                            >
                                                <Edit2 className="size-4" />
                                            </Button>
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

                {/* Edit Roles Dialog */}
                <Dialog
                    open={!!editTarget}
                    onOpenChange={(open) => {
                        if (!open) setEditTarget(null);
                    }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                Manage Roles: {editTarget?.name}
                            </DialogTitle>
                            <DialogDescription>
                                {editTarget?.email}
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSave} className="grid gap-4 py-2">
                            <div className="grid gap-2">
                                <Label>Assign Roles</Label>
                                <div className="grid gap-2">
                                    {allRoles.map((role) => (
                                        <label
                                            key={role.id}
                                            className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-accent"
                                        >
                                            <Checkbox
                                                checked={editForm.data.roles.includes(role.id)}
                                                onCheckedChange={() => toggleRole(role.id)}
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
                                    {editForm.processing ? 'Saving…' : 'Save Roles'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
        </AppLayout>
    );
}
