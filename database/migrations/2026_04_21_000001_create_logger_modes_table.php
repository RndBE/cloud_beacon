<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('logger_modes', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();          // AWLR_US, AWLR_TD, ARR
            $table->string('label');                    // AWLR Ultrasonic, etc.
            $table->string('group');                    // AWLR, ARR
            $table->boolean('has_calibration')->default(false);
            $table->json('calibration_fields')->nullable(); // Dynamic field definitions
            $table->text('description')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('logger_modes');
    }
};
