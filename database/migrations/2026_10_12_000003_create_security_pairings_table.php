<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pemasangan alat Security System ke logger dari website.
 *
 * Teknisi memilih alat di halaman logger, lalu harus MENEMPELKAN KARTU apa
 * saja ke pembaca alat itu dalam jendela waktu singkat. security:listen
 * yang menyelesaikannya begitu kejadian tap kartu dari alat itu masuk: baru
 * saat itu security_devices.logger_id diisi. Dengan begitu salah ketik nomor
 * alat, atau memasangkan alat milik stasiun lain, tidak mungkin terjadi tanpa
 * ada orang yang berdiri di depan alat yang benar.
 *
 * Satu baris per percobaan, bukan per alat: riwayatnya menjadi jejak audit
 * siapa memasang alat apa ke logger mana, dan kapan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_pairings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('security_device_id')->constrained()->cascadeOnDelete();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status', 20)->default('menunggu_tap'); // menunggu_tap | terpasang | kedaluwarsa | dibatalkan
            $table->timestamp('expires_at');
            $table->timestamp('confirmed_at')->nullable();
            $table->foreignId('confirm_event_id')->nullable()->constrained('security_events')->nullOnDelete();
            $table->timestamps();

            $table->index(['security_device_id', 'status']);
            $table->index(['logger_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_pairings');
    }
};
