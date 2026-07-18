<?php

use App\Models\Logger;
use App\Models\Project;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('access_level', 20)->default(Logger::ACCESS_VIEW);
            $table->string('logger_scope', 20)->default(Project::LOGGER_SCOPE_ALL);
            $table->timestamps();

            $table->unique(['project_id', 'user_id']);
            $table->index(['user_id', 'access_level']);
            $table->index(['user_id', 'logger_scope']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_user');
    }
};
