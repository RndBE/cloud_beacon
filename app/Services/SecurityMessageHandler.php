<?php

namespace App\Services;

use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Mengolah satu pesan MQTT dari alat Security System di pub_<id>.
 *
 * Dipisah dari perintah security:listen supaya bisa diuji tanpa broker.
 *
 * Bentuk pesan (firmware D:\Security System\RFID, main.cpp):
 *   - setiap pesan papan berkepala {"id_alat","jam","hari","reading_at"(UTC, Z)}
 *   - "cmd":"event"        -> kejadian {"jenis","detail"}; reading_at = jam kejadian
 *   - "cmd":"event_mentah" -> baris antrean yang tidak terurai {"baris"}
 *   - "cmd":"telemetri"/"status"/"boot" -> keadaan terkini
 *   - "cmd":"foto_mulai"/"foto_data"/"foto_selesai" ("sumber":"kamera") -> potongan
 *     foto; disusun di langkah berikutnya, untuk sementara hanya menandai alat hidup.
 */
class SecurityMessageHandler
{
    // Sebelum NTP/RTC menjawab, jam alat masih di sekitar epoch 0.
    private const TAHUN_JAM_SAH = 2023;

    /** @return string apa yang dilakukan, untuk log pendengar */
    public function handle(string $topic, string $message): string
    {
        if (! str_starts_with($topic, 'pub_')) {
            return 'abaikan: bukan topik pub_';
        }

        $device = SecurityDevice::where('device_id', substr($topic, 4))->first();
        if ($device === null) {
            return 'abaikan: alat tidak terdaftar';
        }

        $data = json_decode($message, true);
        if (! is_array($data)) {
            return 'abaikan: bukan JSON';
        }

        $device->last_seen_at = now();
        $cmd = (string) ($data['cmd'] ?? '');

        $hasil = match ($cmd) {
            'event' => $this->simpanKejadian($device, $data, (string) ($data['jenis'] ?? 'TIDAK_DIKENAL'),
                isset($data['detail']) ? (string) $data['detail'] : null),
            'event_mentah' => $this->simpanKejadian($device, $data, 'MENTAH',
                isset($data['baris']) ? (string) $data['baris'] : null),
            'telemetri', 'status' => $this->simpanStatus($device, $data),
            default => 'tanda hidup: '.($cmd !== '' ? $cmd : 'tanpa cmd'),
        };

        $device->save();

        return $hasil;
    }

    private function simpanStatus(SecurityDevice $device, array $data): string
    {
        $device->last_status = $data;

        return 'status diperbarui';
    }

    private function simpanKejadian(SecurityDevice $device, array $data, string $jenis, ?string $detail): string
    {
        [$waktu, $sah] = $this->waktuKejadian($data);

        // Kunci memakai reading_at mentah, bukan hasil urai: dua kiriman ulang
        // kejadian yang sama membawa string yang persis sama.
        $kunci = hash('sha256', implode("\x1f", [
            $jenis, (string) $detail, (string) ($data['reading_at'] ?? ''),
        ]));

        $event = SecurityEvent::firstOrCreate(
            ['security_device_id' => $device->id, 'dedupe_key' => $kunci],
            [
                'occurred_at' => $waktu,
                'time_valid' => $sah,
                'received_at' => now(),
                'type' => Str::limit($jenis, 40, ''),
                'detail' => $detail === null ? null : Str::limit($detail, 255, ''),
                'payload' => $data,
            ],
        );

        if (! $event->wasRecentlyCreated) {
            return "kejadian ganda diabaikan: {$jenis}";
        }

        Log::info('[Security] kejadian', ['alat' => $device->device_id, 'jenis' => $jenis, 'detail' => $detail]);

        return "kejadian disimpan: {$jenis}";
    }

    /** @return array{0: ?CarbonImmutable, 1: bool} */
    private function waktuKejadian(array $data): array
    {
        $teks = $data['reading_at'] ?? null;
        if (! is_string($teks) || $teks === '') {
            return [null, false];
        }

        // Diubah ke zona aplikasi SEBELUM disimpan: Eloquent menulis tanggal
        // apa adanya tanpa konversi, dan membacanya kembali sebagai zona
        // aplikasi (Asia/Jakarta). Waktu UTC yang disimpan mentah akan
        // terbaca 7 jam lebih awal.
        try {
            $waktu = CarbonImmutable::parse($teks)->setTimezone(config('app.timezone'));
        } catch (\Throwable) {
            return [null, false];
        }

        return [$waktu, $waktu->year >= self::TAHUN_JAM_SAH];
    }
}
