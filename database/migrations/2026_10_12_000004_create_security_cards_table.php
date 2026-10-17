<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Nama pemegang kartu RFID, per alat Security System.
 *
 * Alat hanya menyimpan UID kartu; nama pemegangnya hidup di server dan
 * dicocokkan dengan UID di kejadian kartu (KARTU_SAH, KARTU_DITOLAK, ...),
 * supaya log terbaca "pintu dibuka oleh Budi", bukan "97:6F:BD:62".
 *
 * Per alat, bukan global: satu kartu hanya dipakai di satu alat (keputusan
 * user), dan alat yang berbeda bisa dikelola orang yang berbeda.
 *
 * Baris TIDAK dihapus saat kartu dihapus dari alat: tap kartu yang sudah
 * dicabut aksesnya justru paling perlu tampil dengan nama di log.
 * uid selalu bentuk baku SecurityCard::normalizeUid(): "97:6F:BD:62".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_cards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('security_device_id')->constrained()->cascadeOnDelete();
            $table->string('uid', 32);
            $table->string('holder_name', 100);
            $table->timestamps();

            $table->unique(['security_device_id', 'uid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_cards');
    }
};
