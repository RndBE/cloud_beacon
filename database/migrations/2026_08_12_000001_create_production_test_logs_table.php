<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Hasil uji bench untuk unit produksi yang QC-nya masih 'pending'.
 *
 * Terpisah dari production_firmware_logs: yang itu mencatat riwayat firmware per unit,
 * sedangkan tabel ini mencatat satu sesi pengujian penuh (deretan langkah uji + kesimpulan
 * passed/failed) yang dijalankan operator lewat halaman Testing Logger.
 *
 * `checks` disimpan sebagai JSON, bukan tabel turunan: langkah uji ditentukan halaman
 * (bisa bertambah/berubah tiap rilis firmware) dan tidak pernah di-query per baris —
 * selalu dibaca utuh sebagai satu rekaman sesi.
 *
 * `tested_by` sengaja di-snapshot sebagai string di samping user_id supaya nama penguji
 * di jalur produksi (yang sering bukan pemilik akun login) tetap terbaca walau usernya dihapus.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_test_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('production_device_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('tested_by')->nullable();
            $table->string('result');                                // passed | failed
            $table->unsignedSmallInteger('passed_count')->default(0);
            $table->unsignedSmallInteger('failed_count')->default(0);
            $table->unsignedSmallInteger('skipped_count')->default(0);
            $table->json('checks');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['production_device_id', 'created_at']);
        });

        $this->seedPermission();
    }

    public function down(): void
    {
        DB::table('permissions')->where('name', 'production.testing')->delete();

        Schema::dropIfExists('production_test_logs');
    }

    /**
     * Izin `production.testing` dibuat di sini, bukan hanya di RolePermissionSeeder.
     *
     * Superadmin membaca daftar menunya dari tabel permissions (User::getAllPermissions()),
     * jadi tanpa barisnya menu Testing Logger tidak muncul di instalasi yang sudah jalan.
     * Menjalankan ulang seeder bukan pilihan: seeder memakai sync() pada lima peran bawaan
     * dan akan menghapus penyesuaian izin yang sudah dibuat lewat halaman Roles.
     */
    private function seedPermission(): void
    {
        $existing = DB::table('permissions')->where('name', 'production.testing')->value('id');

        $permissionId = $existing ?: DB::table('permissions')->insertGetId([
            'name' => 'production.testing',
            'display_name' => 'Test Logger Before QC',
            'group' => 'Production',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Selaras dengan RolePermissionSeeder: admin dapat semua kecuali production.delete.
        // Superadmin sudah bypass di middleware, tapi barisnya tetap dipasang agar daftar
        // izin per peran di halaman Roles tidak tampak bolong.
        $roleIds = DB::table('roles')
            ->whereIn('name', ['superadmin', 'admin'])
            ->pluck('id');

        foreach ($roleIds as $roleId) {
            DB::table('role_permission')->insertOrIgnore([
                'role_id' => $roleId,
                'permission_id' => $permissionId,
            ]);
        }
    }
};
