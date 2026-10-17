<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Cara pemasangan dibuktikan: tap kartu (confirm_event_id terisi), atau BUKTI
 * KABEL lewat USB tanpa kejadian apa pun. Tanpa kolom ini
 * pemasangan lewat kabel tidak bisa dibedakan dari baris rusak yang
 * kehilangan kejadiannya.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('security_pairings', function (Blueprint $table) {
            $table->string('confirm_via', 10)->nullable()->after('confirm_event_id'); // tap | usb
        });
    }

    public function down(): void
    {
        Schema::table('security_pairings', function (Blueprint $table) {
            $table->dropColumn('confirm_via');
        });
    }
};
