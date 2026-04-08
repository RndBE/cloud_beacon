<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('logger_integrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained('loggers')->cascadeOnDelete();

            $table->string('name');          // e.g., "BMKG Pusat", "SiPuji BBWS"
            $table->string('endpoint_url');  // HTTP POST destination

            // Auth
            $table->enum('auth_type', ['none', 'api_key', 'bearer', 'basic', 'custom_header'])
                  ->default('none');
            $table->json('auth_config')->nullable(); // { "header": "X-API-Key", "value": "abc" }

            $table->unsignedSmallInteger('interval_minutes')->default(10);
            $table->boolean('is_enabled')->default(true);

            // Forwarding status
            $table->timestamp('last_forwarded_at')->nullable();
            $table->enum('last_status', ['success', 'error'])->nullable();
            $table->text('last_error')->nullable();

            $table->timestamps();

            $table->index(['logger_id', 'is_enabled']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('logger_integrations');
    }
};
