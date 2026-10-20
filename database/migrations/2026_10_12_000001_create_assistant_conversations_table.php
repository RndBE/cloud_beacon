<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assistant_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120)->nullable();
            // Compacted memory of the messages dropped from `api`.
            $table->text('summary')->nullable();
            // What the chat panel shows (cards included) and what the model gets.
            $table->longText('ui');
            $table->longText('api');
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('assistant_conversations');
    }
};
