<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('forwarding_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained('loggers')->cascadeOnDelete();
            $table->foreignId('integration_id')->nullable()->constrained('logger_integrations')->nullOnDelete();

            $table->string('target_name');         // "BMKG Pusat", "Mini STESY", dll
            $table->string('target_url');           // endpoint URL tujuan
            $table->enum('status', ['success', 'error', 'skipped'])->default('success');
            $table->unsignedSmallInteger('http_status')->nullable();  // HTTP response code
            $table->text('error_message')->nullable();
            $table->unsignedInteger('response_time_ms')->nullable();  // response time in ms
            $table->json('payload_summary')->nullable();  // ringkasan payload (sensor count, dll)

            $table->timestamp('created_at')->useCurrent();

            $table->index(['logger_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('forwarding_logs');
    }
};
