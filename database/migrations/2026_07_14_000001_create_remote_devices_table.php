<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('remote_devices', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('host');
            $table->unsignedInteger('port')->default(22);
            $table->string('username');
            $table->string('description')->nullable();
            $table->timestamps();

            $table->unique(['host', 'port', 'username']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('remote_devices');
    }
};
