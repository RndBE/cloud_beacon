<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->foreignId('remote_device_id')
                ->nullable()
                ->after('project_id')
                ->constrained('remote_devices')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('remote_device_id');
        });
    }
};
