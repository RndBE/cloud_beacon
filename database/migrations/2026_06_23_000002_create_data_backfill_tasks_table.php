<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('data_backfill_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->timestamp('minute');
            $table->string('status')->default('pending');
            $table->string('ack_status')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->string('error')->nullable();
            $table->timestamps();

            $table->unique(['logger_id', 'minute']);
            $table->index(['logger_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_backfill_tasks');
    }
};
