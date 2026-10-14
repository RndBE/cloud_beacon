<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A module model's firmware comes as two files: the OTA image (the app alone, sent
 * over the network to a board that already runs firmware) and the factory image
 * (bootloader, partition table and app merged from address 0), which the website
 * flashes over USB onto a blank board. Either may be uploaded first.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('module_firmwares', function (Blueprint $table) {
            $table->string('file_path')->nullable()->change();
            $table->string('file_name')->nullable()->change();
            $table->string('factory_path')->nullable()->after('file_size');
            $table->string('factory_name')->nullable()->after('factory_path');
            $table->unsignedBigInteger('factory_size')->nullable()->after('factory_name');
        });
    }

    public function down(): void
    {
        Schema::table('module_firmwares', function (Blueprint $table) {
            $table->dropColumn(['factory_path', 'factory_name', 'factory_size']);
        });
    }
};
