<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('logger_daily_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->unsignedInteger('expected')->default(1440);
            $table->unsignedInteger('present')->default(0);
            $table->unsignedInteger('missing')->default(0);
            $table->timestamp('last_scanned_at')->nullable();
            $table->timestamps();

            $table->unique(['logger_id', 'date']);
            $table->index('date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('logger_daily_audits');
    }
};
