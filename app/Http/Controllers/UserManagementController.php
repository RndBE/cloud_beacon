<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
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
                'instansi' => $user->instansi,
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

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|max:255|unique:users',
            'instansi' => 'nullable|string|max:255',
            'password' => ['required', 'confirmed', Password::defaults()],
            'roles' => 'array',
            'roles.*' => 'exists:roles,id',
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'instansi' => $validated['instansi'] ?? null,
            'password' => Hash::make($validated['password']),
        ]);

        if (!empty($validated['roles'])) {
            $user->roles()->sync($validated['roles']);
        }

        return redirect()->route('users.index')->with('success', 'User created successfully.');
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|max:255|unique:users,email,' . $user->id,
            'instansi' => 'nullable|string|max:255',
            'password' => ['nullable', 'confirmed', Password::defaults()],
            'roles' => 'array',
            'roles.*' => 'exists:roles,id',
        ]);

        $user->update([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'instansi' => $validated['instansi'] ?? null,
        ]);

        if (!empty($validated['password'])) {
            $user->update([
                'password' => Hash::make($validated['password']),
            ]);
        }

        $user->roles()->sync($validated['roles'] ?? []);

        return redirect()->route('users.index')->with('success', 'User updated successfully.');
    }

    public function destroy(Request $request, int $id): RedirectResponse
    {
        $user = User::findOrFail($id);

        // Cannot delete yourself
        if ($user->id === $request->user()->id) {
            return redirect()->route('users.index')
                ->with('error', 'You cannot delete your own account.');
        }

        // Prevent deleting the last superadmin
        $superadminRole = Role::where('name', 'superadmin')->first();
        if ($superadminRole && $user->hasRole('superadmin')) {
            $superadminCount = $superadminRole->users()->count();
            if ($superadminCount <= 1) {
                return redirect()->route('users.index')
                    ->with('error', 'Cannot delete the last superadmin user.');
            }
        }

        $user->roles()->detach();
        $user->delete();

        return redirect()->route('users.index')->with('success', 'User deleted successfully.');
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
