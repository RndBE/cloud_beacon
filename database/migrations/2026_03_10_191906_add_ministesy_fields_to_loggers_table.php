<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->boolean('ministesy_enabled')->default(false)->after('max_reset');
            $table->string('ministesy_key')->nullable()->after('ministesy_enabled');
            $table->unsignedInteger('ministesy_interval')->default(10)->after('ministesy_key');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['ministesy_enabled', 'ministesy_key', 'ministesy_interval']);
        });
    }
};
