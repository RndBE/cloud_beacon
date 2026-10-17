<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who changed what on a Security System device from the website. The device logs
 * the change itself (ATUR_* events) but cannot know which website user sent it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_config_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('security_device_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 32);
            $table->string('description');
            $table->boolean('ok');
            // The device's reply or the reason it failed.
            $table->string('message')->nullable();
            // internet (MQTT), usb or bluetooth: how the command reached the device.
            $table->string('via', 16)->default('internet');
            $table->timestamps();

            $table->index(['security_device_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_config_logs');
    }
};
