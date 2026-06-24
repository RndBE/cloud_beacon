<?php
// database/migrations/2026_06_24_000001_add_resend_of_to_forwarding_logs.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->unsignedBigInteger('resend_of')->nullable()->index()->after('integration_id');
        });
    }

    public function down(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropColumn('resend_of');
        });
    }
};
