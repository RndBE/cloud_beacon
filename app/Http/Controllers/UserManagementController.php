<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\Project;
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
        $users = User::with([
            'roles:id,name,display_name',
            'assignedLoggers:id,name,serial_number,project_id',
            'assignedProjects:id,name,color',
        ])
            ->orderBy('name')
            ->get()
            ->map(fn (User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'instansi' => $user->instansi,
                'createdAt' => $user->created_at?->format('Y-m-d H:i'),
                'roles' => $user->roles->map(fn ($r) => [
                    'id' => $r->id,
                    'name' => $r->name,
                    'displayName' => $r->display_name,
                ]),
                'assignedLoggers' => $user->assignedLoggers->map(fn (Logger $logger) => [
                    'id' => $logger->id,
                    'name' => $logger->name,
                    'serialNumber' => $logger->serial_number,
                    'projectId' => $logger->project_id,
                    'accessLevel' => $logger->pivot->access_level,
                ]),
                'assignedProjects' => $user->assignedProjects->map(fn (Project $project) => [
                    'id' => $project->id,
                    'accessLevel' => $project->pivot->access_level,
                    'loggerScope' => $project->pivot->logger_scope,
                    'loggerIds' => $user->assignedLoggers
                        ->where('project_id', $project->id)
                        ->pluck('id')
                        ->values(),
                ]),
            ]);

        $roles = Role::orderBy('name')->get()->map(fn (Role $r) => [
            'id' => $r->id,
            'name' => $r->name,
            'displayName' => $r->display_name,
        ]);

        $loggers = Logger::with('project:id,name,color')->orderBy('name')->get()->map(fn (Logger $logger) => [
            'id' => $logger->id,
            'name' => $logger->name,
            'serialNumber' => $logger->serial_number,
            'projectId' => $logger->project_id,
            'projectName' => $logger->project?->name,
            'projectColor' => $logger->project?->color,
        ]);

        $projects = Project::with(['loggers' => fn ($query) => $query->orderBy('name')])
            ->orderBy('name')
            ->get()
            ->map(fn (Project $project) => [
                'id' => $project->id,
                'name' => $project->name,
                'color' => $project->color,
                'loggers' => $project->loggers->map(fn (Logger $logger) => [
                    'id' => $logger->id,
                    'name' => $logger->name,
                    'serialNumber' => $logger->serial_number,
                    'projectId' => $logger->project_id,
                    'projectName' => $project->name,
                    'projectColor' => $project->color,
                ]),
            ]);

        return Inertia::render('users/index', [
            'users' => $users,
            'allRoles' => $roles,
            'allLoggers' => $loggers,
            'allProjects' => $projects,
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
            'project_access' => 'array',
            'project_access.*.access_level' => 'required|in:'.Logger::ACCESS_VIEW.','.Logger::ACCESS_MANAGE,
            'project_access.*.logger_scope' => 'required|in:'.Project::LOGGER_SCOPE_ALL.','.Project::LOGGER_SCOPE_SELECTED,
            'project_access.*.logger_ids' => 'array',
            'project_access.*.logger_ids.*' => 'integer|exists:loggers,id',
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'instansi' => $validated['instansi'] ?? null,
            'password' => Hash::make($validated['password']),
        ]);

        if (! empty($validated['roles'])) {
            $user->roles()->sync($validated['roles']);
        }

        $projectLoggerAccess = $this->syncProjectAccess($user, $validated['project_access'] ?? []);
        $this->syncLoggerAccess($user, array_replace($validated['logger_access'] ?? [], $projectLoggerAccess));

        return redirect()->route('users.index')->with('success', 'User created successfully.');
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|max:255|unique:users,email,'.$user->id,
            'instansi' => 'nullable|string|max:255',
            'password' => ['nullable', 'confirmed', Password::defaults()],
            'roles' => 'array',
            'roles.*' => 'exists:roles,id',
            'logger_access' => 'array',
            'logger_access.*' => 'in:'.Logger::ACCESS_VIEW.','.Logger::ACCESS_MANAGE,
            'project_access' => 'array',
            'project_access.*.access_level' => 'required|in:'.Logger::ACCESS_VIEW.','.Logger::ACCESS_MANAGE,
            'project_access.*.logger_scope' => 'required|in:'.Project::LOGGER_SCOPE_ALL.','.Project::LOGGER_SCOPE_SELECTED,
            'project_access.*.logger_ids' => 'array',
            'project_access.*.logger_ids.*' => 'integer|exists:loggers,id',
        ]);

        $user->update([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'instansi' => $validated['instansi'] ?? null,
        ]);

        if (! empty($validated['password'])) {
            $user->update([
                'password' => Hash::make($validated['password']),
            ]);
        }

        $user->roles()->sync($validated['roles'] ?? []);
        $projectLoggerAccess = $this->syncProjectAccess($user, $validated['project_access'] ?? []);
        $this->syncLoggerAccess($user, array_replace($validated['logger_access'] ?? [], $projectLoggerAccess));

        return redirect()->route('users.index')->with('success', 'User updated successfully.');
    }

    private function syncProjectAccess(User $user, array $projectAccess): array
    {
        $projectIds = collect(array_keys($projectAccess))
            ->filter(fn ($id) => is_numeric($id))
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($projectIds->isEmpty()) {
            $user->assignedProjects()->sync([]);

            return [];
        }

        $projects = Project::with('loggers:id,project_id')
            ->whereIn('id', $projectIds)
            ->get()
            ->keyBy('id');

        $syncPayload = [];
        $selectedLoggerAccess = [];

        foreach ($projectIds as $projectId) {
            $project = $projects->get($projectId);
            if (! $project) {
                continue;
            }

            $access = $projectAccess[$projectId]['access_level'] ?? Logger::ACCESS_VIEW;
            $scope = $projectAccess[$projectId]['logger_scope'] ?? Project::LOGGER_SCOPE_ALL;

            $syncPayload[$projectId] = [
                'access_level' => $access,
                'logger_scope' => $scope,
            ];

            if ($scope !== Project::LOGGER_SCOPE_SELECTED) {
                continue;
            }

            $validLoggerIds = collect($projectAccess[$projectId]['logger_ids'] ?? [])
                ->filter(fn ($id) => is_numeric($id))
                ->map(fn ($id) => (int) $id)
                ->intersect($project->loggers->pluck('id'))
                ->values();

            foreach ($validLoggerIds as $loggerId) {
                $selectedLoggerAccess[$loggerId] = $access;
            }
        }

        $user->assignedProjects()->sync($syncPayload);

        return $selectedLoggerAccess;
    }

    private function syncLoggerAccess(User $user, array $loggerAccess): void
    {
        $loggerIds = collect(array_keys($loggerAccess))
            ->filter(fn ($id) => is_numeric($id))
            ->map(fn ($id) => (int) $id)
            ->values();

        if ($loggerIds->isEmpty()) {
            $user->assignedLoggers()->sync([]);

            return;
        }

        $existingIds = Logger::whereIn('id', $loggerIds)->pluck('id');
        $syncPayload = $existingIds->mapWithKeys(fn (int $id) => [
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
            if ($superadminCount <= 1 && ! in_array($superadminRole->id, $validated['roles'] ?? [])) {
                return redirect()->route('users.index')
                    ->with('error', 'Cannot remove superadmin role from the last superadmin user.');
            }
        }

        $user->roles()->sync($validated['roles'] ?? []);

        return redirect()->route('users.index')->with('success', 'User roles updated successfully.');
    }
}
