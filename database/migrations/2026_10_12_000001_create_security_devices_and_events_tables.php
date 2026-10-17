<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Alat Security System dan kejadian yang dilaporkannya.
 *
 * security_devices: satu baris per alat (device_id = ID MQTT, misalnya SS0001).
 * logger_id sengaja boleh kosong: alat bisa terdaftar dan didengar sebelum
 * dipasang di stasiun mana pun, lalu dipasangkan ke logger belakangan.
 * last_status menyimpan pesan telemetri/status terakhir utuh (JSON), karena
 * kartu status cukup membaca keadaan terkini - riwayatnya tidak di-query.
 *
 * security_events: satu baris per kejadian ("cmd":"event") dari alat.
 * occurred_at adalah jam KEJADIAN menurut alat, bukan jam diterima: alat
 * menahan kejadian di antrean saat jaringan mati lalu mengirimnya belakangan.
 * received_at mencatat kapan server benar-benar menerimanya.
 *
 * dedupe_key mencegah kejadian yang sama tercatat dua kali. Alat membuang
 * kejadian dari antreannya hanya setelah publish berhasil, jadi publish yang
 * sampai di broker tapi gagal dilaporkan ke alat akan terkirim ulang.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_devices', function (Blueprint $table) {
            $table->id();
            $table->string('device_id', 32)->unique();
            $table->string('name')->nullable();
            $table->foreignId('logger_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('last_seen_at')->nullable();
            $table->json('last_status')->nullable();
            $table->timestamps();
        });

        Schema::create('security_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('security_device_id')->constrained()->cascadeOnDelete();
            $table->timestamp('occurred_at')->nullable();
            $table->boolean('time_valid')->default(true);   // false = jam alat belum sinkron
            $table->timestamp('received_at');
            $table->string('type', 40);                     // jenis: PEMBOBOLAN, KARTU_SAH, ...
            $table->string('detail')->nullable();
            $table->json('payload');
            $table->char('dedupe_key', 64);
            $table->timestamps();

            $table->unique(['security_device_id', 'dedupe_key']);
            $table->index(['security_device_id', 'occurred_at']);
            $table->index(['security_device_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_events');
        Schema::dropIfExists('security_devices');
    }
};
