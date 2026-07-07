<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('maintenance_tickets', function (Blueprint $table) {
            $table->date('performed_at')->nullable()->after('assigned_to');
            $table->json('issues')->nullable()->after('issue_description');
            $table->json('repairs')->nullable()->after('repair_action');
            $table->string('report_path')->nullable()->after('technician_notes');
            $table->json('documentation_photos')->nullable()->after('report_path');
        });
    }

    public function down(): void
    {
        Schema::table('maintenance_tickets', function (Blueprint $table) {
            $table->dropColumn([
                'performed_at',
                'issues',
                'repairs',
                'report_path',
                'documentation_photos',
            ]);
        });
    }
};
