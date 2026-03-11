<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class UserManagementController extends Controller
{
    public function index(): Response
    {
        $users = User::with('roles:id,name,display_name')
            ->orderBy('name')
            ->get()
            ->map(fn(User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'createdAt' => $user->created_at?->format('Y-m-d H:i'),
                'roles' => $user->roles->map(fn($r) => [
                    'id' => $r->id,
                    'name' => $r->name,
                    'displayName' => $r->display_name,
                ]),
            ]);

        $roles = Role::orderBy('name')->get()->map(fn(Role $r) => [
            'id' => $r->id,
            'name' => $r->name,
            'displayName' => $r->display_name,
        ]);

        return Inertia::render('users/index', [
            'users' => $users,
            'allRoles' => $roles,
        ]);
    }

    public function updateRoles(Request $request, int $id): RedirectResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'roles' => 'array',
            'roles.*' => 'exists:roles,id',
        ]);

        // Prevent removing superadmin role from the last superadmin
        $superadminRole = Role::where('name', 'superadmin')->first();
        if ($superadminRole && $user->hasRole('superadmin')) {
            $superadminCount = $superadminRole->users()->count();
            if ($superadminCount <= 1 && !in_array($superadminRole->id, $validated['roles'] ?? [])) {
                return redirect()->route('users.index')
                    ->with('error', 'Cannot remove superadmin role from the last superadmin user.');
            }
        }

        $user->roles()->sync($validated['roles'] ?? []);

        return redirect()->route('users.index')->with('success', 'User roles updated successfully.');
    }
}
