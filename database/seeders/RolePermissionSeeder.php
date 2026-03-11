<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RolePermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permissions = [
            // Dashboard
            ['name' => 'dashboard.view', 'display_name' => 'View Dashboard', 'group' => 'Dashboard'],

            // Loggers
            ['name' => 'loggers.view', 'display_name' => 'View Loggers', 'group' => 'Loggers'],
            ['name' => 'loggers.create', 'display_name' => 'Create Loggers', 'group' => 'Loggers'],
            ['name' => 'loggers.delete', 'display_name' => 'Delete Loggers', 'group' => 'Loggers'],

            // Production
            ['name' => 'production.view', 'display_name' => 'View Production', 'group' => 'Production'],
            ['name' => 'production.create', 'display_name' => 'Create Production Device', 'group' => 'Production'],
            ['name' => 'production.import', 'display_name' => 'Import Production Devices', 'group' => 'Production'],
            ['name' => 'production.delete', 'display_name' => 'Delete Production Device', 'group' => 'Production'],
            ['name' => 'production.check-serial', 'display_name' => 'Check Serial Number', 'group' => 'Production'],

            // Topology
            ['name' => 'topology.view', 'display_name' => 'View Topology', 'group' => 'Topology'],

            // MQTT
            ['name' => 'mqtt.request-info', 'display_name' => 'Request MQTT Info', 'group' => 'MQTT'],
            ['name' => 'mqtt.poll', 'display_name' => 'Poll MQTT Devices', 'group' => 'MQTT'],

            // RBAC Management
            ['name' => 'roles.view', 'display_name' => 'View Roles', 'group' => 'RBAC'],
            ['name' => 'roles.create', 'display_name' => 'Create Roles', 'group' => 'RBAC'],
            ['name' => 'roles.update', 'display_name' => 'Update Roles', 'group' => 'RBAC'],
            ['name' => 'roles.delete', 'display_name' => 'Delete Roles', 'group' => 'RBAC'],
            ['name' => 'users.view', 'display_name' => 'View Users', 'group' => 'RBAC'],
            ['name' => 'users.manage-roles', 'display_name' => 'Manage User Roles', 'group' => 'RBAC'],
        ];

        foreach ($permissions as $perm) {
            Permission::firstOrCreate(['name' => $perm['name']], $perm);
        }

        $allPermissions = Permission::all();

        // Superadmin — all permissions
        $superadmin = Role::firstOrCreate(
            ['name' => 'superadmin'],
            ['display_name' => 'Super Admin', 'description' => 'Full access to all features']
        );
        $superadmin->permissions()->sync($allPermissions->pluck('id'));

        // Admin — all except production.delete
        $admin = Role::firstOrCreate(
            ['name' => 'admin'],
            ['display_name' => 'Admin', 'description' => 'Administrative access']
        );
        $admin->permissions()->sync(
            $allPermissions->where('name', '!=', 'production.delete')->pluck('id')
        );

        // Operator — dashboard, loggers (view/create), topology, mqtt, production check-serial
        $operator = Role::firstOrCreate(
            ['name' => 'operator'],
            ['display_name' => 'Operator', 'description' => 'Operational access']
        );
        $operator->permissions()->sync(
            $allPermissions->whereIn('name', [
                'dashboard.view',
                'loggers.view',
                'loggers.create',
                'topology.view',
                'mqtt.request-info',
                'mqtt.poll',
                'production.check-serial',
            ])->pluck('id')
        );

        // Viewer — read-only
        $viewer = Role::firstOrCreate(
            ['name' => 'viewer'],
            ['display_name' => 'Viewer', 'description' => 'Read-only access']
        );
        $viewer->permissions()->sync(
            $allPermissions->whereIn('name', [
                'dashboard.view',
                'loggers.view',
                'topology.view',
                'production.view',
            ])->pluck('id')
        );
    }
}
