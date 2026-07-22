<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

final class CloudWebPermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permission = Permission::firstOrCreate(
            ['name' => 'cloudweb.connect'],
            ['display_name' => 'Open Device Web', 'group' => 'Cloud Web'],
        );

        Role::whereIn('name', ['superadmin', 'admin'])
            ->each(fn (Role $role) => $role->permissions()->syncWithoutDetaching([$permission->id]));
    }
}
