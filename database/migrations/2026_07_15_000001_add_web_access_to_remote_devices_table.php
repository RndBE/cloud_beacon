<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('remote_devices', function (Blueprint $table) {
            $table->boolean('web_enabled')->default(false)->after('description');
            $table->string('web_slug', 63)->nullable()->unique()->after('web_enabled');
            $table->unsignedSmallInteger('web_port')->default(80)->after('web_slug');
        });
    }

    public function down(): void
    {
        Schema::table('remote_devices', function (Blueprint $table) {
            $table->dropUnique(['web_slug']);
            $table->dropColumn(['web_enabled', 'web_slug', 'web_port']);
        });
    }
};
