<?php
// database/migrations/2026_06_24_000002_add_resend_requested_at_to_forwarding_logs.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->timestamp('resend_requested_at')->nullable()->index()->after('resend_of');
        });
    }

    public function down(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropColumn('resend_requested_at');
        });
    }
};
