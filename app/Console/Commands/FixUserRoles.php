<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use Illuminate\Console\Command;

class FixUserRoles extends Command
{
    protected $signature = 'users:fix-roles
                            {--seed-rbac : Run RolePermissionSeeder first if tables are empty}
                            {--assign-superadmin= : Email of user to assign superadmin role}';

    protected $description = 'Diagnose and fix user role issues (403 Forbidden after login)';

    public function handle(): int
    {
        $this->info('=== RBAC Diagnostic ===');

        // 1. Check if roles table has data
        $roleCount = Role::count();
        $this->line("Roles in database: {$roleCount}");

        if ($roleCount === 0) {
            $this->error('No roles found in database! RBAC tables are empty.');

            if ($this->option('seed-rbac') || $this->confirm('Run RolePermissionSeeder now?')) {
                $this->call('db:seed', ['--class' => 'Database\\Seeders\\RolePermissionSeeder']);
                $this->info('RolePermissionSeeder executed successfully.');
                $roleCount = Role::count();
                $this->line("Roles now in database: {$roleCount}");
            } else {
                $this->warn('Run: php artisan db:seed --class=RolePermissionSeeder');
                return 1;
            }
        }

        // 2. List all roles
        $this->newLine();
        $this->info('Available roles:');
        $roles = Role::withCount('users')->get();
        $this->table(
            ['ID', 'Name', 'Display Name', 'Users'],
            $roles->map(fn($r) => [$r->id, $r->name, $r->display_name, $r->users_count])
        );

        // 3. Check users without roles
        $usersWithoutRoles = User::doesntHave('roles')->get();
        if ($usersWithoutRoles->isNotEmpty()) {
            $this->newLine();
            $this->warn("Users WITHOUT any role ({$usersWithoutRoles->count()}):");
            $this->table(
                ['ID', 'Name', 'Email', 'Created At'],
                $usersWithoutRoles->map(fn($u) => [$u->id, $u->name, $u->email, $u->created_at])
            );
            $this->warn('These users will get 403 Forbidden on every page!');

            if ($this->confirm('Assign "viewer" role to all users without roles?')) {
                $viewerRole = Role::where('name', 'viewer')->first();
                if ($viewerRole) {
                    foreach ($usersWithoutRoles as $user) {
                        $user->roles()->syncWithoutDetaching([$viewerRole->id]);
                        $this->line("  Assigned 'viewer' to: {$user->email}");
                    }
                    $this->info('Done.');
                } else {
                    $this->error('Viewer role not found. Run seeder first.');
                }
            }
        } else {
            $this->info('All users have at least one role assigned.');
        }

        // 4. Optionally assign superadmin
        $superadminEmail = $this->option('assign-superadmin');
        if ($superadminEmail) {
            $user = User::where('email', $superadminEmail)->first();
            if (!$user) {
                $this->error("User with email '{$superadminEmail}' not found.");
                return 1;
            }

            $superadminRole = Role::where('name', 'superadmin')->first();
            if (!$superadminRole) {
                $this->error('Superadmin role not found. Run seeder first.');
                return 1;
            }

            $user->roles()->syncWithoutDetaching([$superadminRole->id]);
            $this->info("Superadmin role assigned to: {$user->email}");
        }

        // 5. Check superadmin exists
        $this->newLine();
        $superadminRole = Role::where('name', 'superadmin')->first();
        if ($superadminRole) {
            $superadmins = $superadminRole->users;
            if ($superadmins->isEmpty()) {
                $this->error('WARNING: No user has superadmin role!');
                $this->warn('Run: php artisan users:fix-roles --assign-superadmin=your@email.com');
            } else {
                $this->info('Superadmin users:');
                foreach ($superadmins as $sa) {
                    $this->line("  - {$sa->name} ({$sa->email})");
                }
            }
        }

        return 0;
    }
}
