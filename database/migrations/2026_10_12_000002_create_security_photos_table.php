<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Foto dari kamera alat Security System.
 *
 * Kamera mengirim foto lewat MQTT dalam potongan (foto_mulai -> foto_data
 * seq 0..n-1 -> foto_selesai). security:listen menyusunnya jadi berkas JPEG
 * di disk privat 'local' (storage/app/private/security/<device>/...). Foto
 * ini bukti keamanan, jadi sengaja TIDAK di disk public.
 *
 * name adalah path berkas di kartu SD kamera ('/20261012_093025.jpg'),
 * sama persis dengan detail kejadian FOTO dari papan. Itulah kunci yang
 * menautkan foto ke kejadiannya, ke arah mana pun keduanya tiba lebih dulu.
 *
 * Baris tetap dibuat walau foto tidak lengkap (complete = false): potongan
 * MQTT QoS 0 bisa hilang, dan pendengar meminta kamera mengirim ulang dari
 * kartu SD-nya. resend_count membatasi permintaan itu.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('security_photos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('security_device_id')->constrained()->cascadeOnDelete();
            $table->foreignId('security_event_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 96);
            $table->string('path')->nullable();          // null selama belum lengkap
            $table->unsignedInteger('size')->nullable();
            $table->unsignedSmallInteger('chunks_expected')->nullable();
            $table->unsignedSmallInteger('chunks_received')->default(0);
            $table->boolean('complete')->default(false);
            $table->unsignedTinyInteger('resend_count')->default(0);
            $table->timestamp('captured_at')->nullable();
            $table->timestamps();

            $table->unique(['security_device_id', 'name']);
            $table->index(['security_device_id', 'captured_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('security_photos');
    }
};
