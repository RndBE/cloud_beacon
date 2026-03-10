<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('production_devices', function (Blueprint $table) {
            $table->id();
            $table->string('serial_number')->unique();
            $table->string('device_id')->nullable()->comment('Factory device identifier');
            $table->string('model')->nullable();
            $table->string('hardware_version')->nullable();
            $table->string('batch_number')->nullable();
            $table->date('production_date')->nullable();
            $table->string('tested_by')->nullable();
            $table->enum('qc_status', ['passed', 'failed', 'pending'])->default('pending');
            $table->text('notes')->nullable();
            $table->boolean('is_registered')->default(false)->comment('True when a logger claims this device');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_devices');
    }
};
