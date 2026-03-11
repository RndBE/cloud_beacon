<?php

namespace Database\Seeders;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Seed roles and permissions first
        $this->call(RolePermissionSeeder::class);

        // Create superadmin user
        $superadmin = User::factory()->create([
            'name' => 'Super Admin',
            'email' => 'superadmin@beacon.cloud',
        ]);
        $superadmin->roles()->sync(Role::where('name', 'superadmin')->pluck('id'));

        // Create test user with viewer role
        $testUser = User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);
        $testUser->roles()->sync(Role::where('name', 'viewer')->pluck('id'));

        $this->call([
            LoggerSeeder::class,
            ProductionDeviceSeeder::class,
        ]);
    }
}
