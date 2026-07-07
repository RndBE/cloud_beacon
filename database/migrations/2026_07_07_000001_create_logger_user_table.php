<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('logger_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('access_level', 20)->default('view');
            $table->timestamps();

            $table->unique(['logger_id', 'user_id']);
            $table->index(['user_id', 'access_level']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('logger_user');
    }
};
