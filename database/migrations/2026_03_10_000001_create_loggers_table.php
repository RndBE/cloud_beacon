<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('loggers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('serial_number')->unique();
            $table->string('location')->nullable();
            $table->enum('status', ['online', 'offline', 'warning'])->default('offline');
            $table->string('connection_type')->default('ethernet'); // ethernet, wifi, cellular, 4g-lte
            $table->string('firmware_version')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->string('ip_address')->nullable();
            $table->string('mac_address')->nullable();
            $table->string('model')->nullable();
            $table->string('uptime')->nullable();
            $table->unsignedTinyInteger('cpu_usage')->default(0);
            $table->unsignedInteger('memory_usage')->default(0); // MB
            $table->unsignedInteger('memory_total')->default(512); // MB
            $table->decimal('storage_usage', 8, 2)->default(0); // GB
            $table->decimal('storage_total', 8, 2)->default(4); // GB
            $table->unsignedTinyInteger('signal_strength')->default(0); // 0-100
            $table->string('data_usage')->nullable();
            $table->string('gateway')->nullable();
            $table->string('dns')->nullable();
            $table->string('subnet')->nullable();
            $table->unsignedInteger('log_file_count')->default(0);
            $table->unsignedInteger('config_backups')->default(0);
            $table->timestamp('last_config_backup_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loggers');
    }
};
