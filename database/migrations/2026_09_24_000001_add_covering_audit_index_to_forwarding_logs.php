<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Replace forwarding_logs_logger_id_created_at_index with a covering version.
 *
 * The Data Audit list groups one day of first-attempt rows by
 * (logger_id, integration_id, target_name, status). With only
 * (logger_id, created_at) indexed, MariaDB had to fetch every matching row to
 * read the other columns — ~50k rows a day, each carrying ~1 KB of
 * raw_payload JSON — so the query cost 4 s whenever those pages had been
 * evicted from the buffer pool, against 250 ms warm. Carrying the grouped
 * columns in the index lets it answer without touching the table.
 *
 * The new index keeps (logger_id, created_at) as its leftmost prefix, so it
 * serves every query the old one did and still satisfies the logger_id
 * foreign key — the old one is dead weight and is dropped, as with
 * drop_redundant_sensor_logs_index.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->index(
                ['logger_id', 'created_at', 'resend_of', 'status', 'integration_id', 'target_name'],
                'forwarding_logs_audit_covering_index'
            );
        });

        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropIndex('forwarding_logs_logger_id_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->index(['logger_id', 'created_at']);
        });

        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropIndex('forwarding_logs_audit_covering_index');
        });
    }
};
