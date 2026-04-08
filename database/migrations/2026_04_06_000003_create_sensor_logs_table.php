<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('sensor_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sensor_id')->nullable()->constrained()->nullOnDelete();
            $table->string('sensor_name');      // nama dari JSON (e.g. "Rain Fall")
            $table->string('sensor_key');       // key dari JSON (e.g. "sensor1")
            $table->decimal('value', 12, 4);
            $table->string('unit')->nullable();
            $table->timestamp('recorded_at');   // timestamp dari device (hari + jam)
            $table->timestamps();

            // Index for time-series queries
            $table->index(['logger_id', 'recorded_at']);
            $table->index(['logger_id', 'sensor_key', 'recorded_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sensor_logs');
    }
};
