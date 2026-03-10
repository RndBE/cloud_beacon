<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('sensors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('type'); // temperature, humidity, pressure, water-level, flow-rate, rainfall, voltage, current
            $table->decimal('value', 12, 4)->default(0);
            $table->string('unit');
            $table->enum('status', ['active', 'inactive', 'error'])->default('active');
            $table->timestamp('last_reading_at')->nullable();
            $table->decimal('min_value', 12, 4)->default(0);
            $table->decimal('max_value', 12, 4)->default(100);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sensors');
    }
};
