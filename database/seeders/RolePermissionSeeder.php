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
            ['name' => 'production.provision', 'display_name' => 'Provision Logger via USB', 'group' => 'Production'],
            ['name' => 'production.import', 'display_name' => 'Import Production Devices', 'group' => 'Production'],
            ['name' => 'production.delete', 'display_name' => 'Delete Production Device', 'group' => 'Production'],
            ['name' => 'production.check-serial', 'display_name' => 'Check Serial Number', 'group' => 'Production'],

            // Topology
            ['name' => 'topology.view', 'display_name' => 'View Topology', 'group' => 'Topology'],

            // MQTT
            ['name' => 'mqtt.request-info', 'display_name' => 'Request MQTT Info', 'group' => 'MQTT'],
            ['name' => 'mqtt.poll', 'display_name' => 'Poll MQTT Devices', 'group' => 'MQTT'],

            // Maintenance
            ['name' => 'maintenance.view', 'display_name' => 'View Maintenance Tickets', 'group' => 'Maintenance'],
            ['name' => 'maintenance.create', 'display_name' => 'Create Maintenance Tickets', 'group' => 'Maintenance'],
            ['name' => 'maintenance.update', 'display_name' => 'Update Maintenance Tickets', 'group' => 'Maintenance'],
            ['name' => 'maintenance.close', 'display_name' => 'Close Maintenance Tickets', 'group' => 'Maintenance'],
            ['name' => 'maintenance.delete', 'display_name' => 'Delete Maintenance Tickets', 'group' => 'Maintenance'],

            // Cloud SSH
            ['name' => 'cloudssh.view', 'display_name' => 'View Remote Devices', 'group' => 'Cloud SSH'],
            ['name' => 'cloudssh.connect', 'display_name' => 'Open SSH Terminal', 'group' => 'Cloud SSH'],
            ['name' => 'cloudssh.manage', 'display_name' => 'Manage Remote Devices', 'group' => 'Cloud SSH'],

            // Cloud Web
            ['name' => 'cloudweb.connect', 'display_name' => 'Open Device Web', 'group' => 'Cloud Web'],

            // RBAC Management
            ['name' => 'roles.view', 'display_name' => 'View Roles', 'group' => 'RBAC'],
            ['name' => 'roles.create', 'display_name' => 'Create Roles', 'group' => 'RBAC'],
            ['name' => 'roles.update', 'display_name' => 'Update Roles', 'group' => 'RBAC'],
            ['name' => 'roles.delete', 'display_name' => 'Delete Roles', 'group' => 'RBAC'],
            ['name' => 'users.view', 'display_name' => 'View Users', 'group' => 'RBAC'],
            ['name' => 'users.create', 'display_name' => 'Create Users', 'group' => 'RBAC'],
            ['name' => 'users.update', 'display_name' => 'Update Users', 'group' => 'RBAC'],
            ['name' => 'users.delete', 'display_name' => 'Delete Users', 'group' => 'RBAC'],
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
                'maintenance.view',
                'maintenance.create',
                'maintenance.delete',
                'cloudssh.view',
            ])->pluck('id')
        );

        // Technician — maintenance workflow + read-only logger context
        $technician = Role::firstOrCreate(
            ['name' => 'technician'],
            ['display_name' => 'Technician', 'description' => 'Maintenance and repair access']
        );
        $technician->permissions()->sync(
            $allPermissions->whereIn('name', [
                'dashboard.view',
                'loggers.view',
                'maintenance.view',
                'maintenance.update',
                'cloudssh.view',
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
