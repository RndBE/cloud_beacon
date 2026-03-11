<?php

namespace App\Http\Controllers;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class RoleController extends Controller
{
    public function index(): Response
    {
        $roles = Role::withCount('users')
            ->with('permissions:id,name,display_name,group')
            ->orderBy('name')
            ->get()
            ->map(fn(Role $role) => [
                'id' => $role->id,
                'name' => $role->name,
                'displayName' => $role->display_name,
                'description' => $role->description,
                'usersCount' => $role->users_count,
                'permissions' => $role->permissions->map(fn($p) => [
                    'id' => $p->id,
                    'name' => $p->name,
                    'displayName' => $p->display_name,
                    'group' => $p->group,
                ]),
            ]);

        $permissions = Permission::orderBy('group')->orderBy('name')->get()
            ->map(fn(Permission $p) => [
                'id' => $p->id,
                'name' => $p->name,
                'displayName' => $p->display_name,
                'group' => $p->group,
            ]);

        return Inertia::render('roles/index', [
            'roles' => $roles,
            'allPermissions' => $permissions,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255|unique:roles|alpha_dash',
            'display_name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
            'permissions' => 'array',
            'permissions.*' => 'exists:permissions,id',
        ]);

        $role = Role::create([
            'name' => $validated['name'],
            'display_name' => $validated['display_name'],
            'description' => $validated['description'] ?? null,
        ]);

        if (!empty($validated['permissions'])) {
            $role->permissions()->sync($validated['permissions']);
        }

        return redirect()->route('roles.index')->with('success', 'Role created successfully.');
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $role = Role::findOrFail($id);

        if ($role->name === 'superadmin') {
            return redirect()->route('roles.index')->with('error', 'Cannot modify the superadmin role.');
        }

        $validated = $request->validate([
            'display_name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
            'permissions' => 'array',
            'permissions.*' => 'exists:permissions,id',
        ]);

        $role->update([
            'display_name' => $validated['display_name'],
            'description' => $validated['description'] ?? null,
        ]);

        $role->permissions()->sync($validated['permissions'] ?? []);

        return redirect()->route('roles.index')->with('success', 'Role updated successfully.');
    }

    public function destroy(int $id): RedirectResponse
    {
        $role = Role::findOrFail($id);

        if ($role->name === 'superadmin') {
            return redirect()->route('roles.index')->with('error', 'Cannot delete the superadmin role.');
        }

        if ($role->users()->count() > 0) {
            return redirect()->route('roles.index')->with('error', 'Cannot delete a role that has users assigned.');
        }

        $role->delete();

        return redirect()->route('roles.index')->with('success', 'Role deleted successfully.');
    }
}
