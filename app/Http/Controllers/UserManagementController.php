<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Models\Logger;
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
        $users = User::with(['roles:id,name,display_name', 'assignedLoggers:id,name,serial_number'])
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
                'assignedLoggers' => $user->assignedLoggers->map(fn(Logger $logger) => [
                    'id' => $logger->id,
                    'name' => $logger->name,
                    'serialNumber' => $logger->serial_number,
                    'accessLevel' => $logger->pivot->access_level,
                ]),
            ]);

        $roles = Role::orderBy('name')->get()->map(fn(Role $r) => [
            'id' => $r->id,
            'name' => $r->name,
            'displayName' => $r->display_name,
        ]);

        $loggers = Logger::orderBy('name')->get()->map(fn(Logger $logger) => [
            'id' => $logger->id,
            'name' => $logger->name,
            'serialNumber' => $logger->serial_number,
        ]);

        return Inertia::render('users/index', [
            'users' => $users,
            'allRoles' => $roles,
            'allLoggers' => $loggers,
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
            'logger_access' => 'array',
            'logger_access.*' => 'in:'.Logger::ACCESS_VIEW.','.Logger::ACCESS_MANAGE,
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

        $this->syncLoggerAccess($user, $validated['logger_access'] ?? []);

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
            'logger_access' => 'array',
            'logger_access.*' => 'in:'.Logger::ACCESS_VIEW.','.Logger::ACCESS_MANAGE,
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
        $this->syncLoggerAccess($user, $validated['logger_access'] ?? []);

        return redirect()->route('users.index')->with('success', 'User updated successfully.');
    }

    private function syncLoggerAccess(User $user, array $loggerAccess): void
    {
        $loggerIds = collect(array_keys($loggerAccess))
            ->filter(fn($id) => is_numeric($id))
            ->map(fn($id) => (int) $id)
            ->values();

        if ($loggerIds->isEmpty()) {
            $user->assignedLoggers()->sync([]);

            return;
        }

        $existingIds = Logger::whereIn('id', $loggerIds)->pluck('id');
        $syncPayload = $existingIds->mapWithKeys(fn(int $id) => [
            $id => ['access_level' => $loggerAccess[$id] ?? Logger::ACCESS_VIEW],
        ])->all();

        $user->assignedLoggers()->sync($syncPayload);
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
