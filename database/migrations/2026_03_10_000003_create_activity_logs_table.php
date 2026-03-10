<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->string('action');
            $table->enum('status', ['success', 'failed', 'pending'])->default('success');
            $table->enum('level', ['info', 'warning', 'error', 'debug'])->default('info');
            $table->text('message')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
