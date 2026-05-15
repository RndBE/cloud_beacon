<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_models', function (Blueprint $table) {
            $table->string('firmware_version')->nullable()->after('image');
            $table->string('firmware_file_path')->nullable()->after('firmware_version');
            $table->string('firmware_file_name')->nullable()->after('firmware_file_path');
            $table->unsignedBigInteger('firmware_file_size')->nullable()->after('firmware_file_name');
            $table->timestamp('firmware_uploaded_at')->nullable()->after('firmware_file_size');
        });

        Schema::create('device_model_firmware_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('device_model_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action')->default('firmware_updated');
            $table->string('from_version')->nullable();
            $table->string('to_version')->nullable();
            $table->string('file_name')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->text('message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_model_firmware_logs');

        Schema::table('device_models', function (Blueprint $table) {
            $table->dropColumn([
                'firmware_version',
                'firmware_file_path',
                'firmware_file_name',
                'firmware_file_size',
                'firmware_uploaded_at',
            ]);
        });
    }
};
