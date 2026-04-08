<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device_models', function (Blueprint $table) {
            $table->unsignedTinyInteger('channel_count')->default(0)->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('device_models', function (Blueprint $table) {
            $table->dropColumn('channel_count');
        });
    }
};
