<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\ForwardToIntegrations;
use App\Models\Logger;
use App\Models\Sensor;
use App\Models\SensorLog;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class DeviceDataController extends Controller
{
    /**
     * POST /api/v1/device/push
     *
     * Menerima data sensor dari perangkat logger dalam format JSON berikut:
     * {
     *   "id_alat": "30069",
     *   "jam": "10:05:00",
     *   "hari": "2026-03-31",
     *   "sensor1":  { "nama": "Rain Fall",    "nilai": 0,     "satuan": "cm"  },
     *   "sensor5":  { "nama": "TEMP_BELIMO",  "nilai": 25.64, "satuan": "C"   },
     *   "sensor7":  {}   <- sensor kosong, diabaikan
     * }
     *
     * Alur matching:
     *   1. Exact match nama (case-insensitive) → prioritas tertinggi
     *   2. Partial match: DB sensor name yang mengandung nama dari device (atau sebaliknya)
     *
     * Setiap sensor yang cocok di-update nilai + last_reading_at + unit-nya di tabel sensors.
     * Semua data (matched maupun unmatched) disimpan ke sensor_logs sebagai histori.
     */
    public function push(Request $request): JsonResponse
    {
        // --- 1. Validasi struktur dasar ---
        $validated = $request->validate([
            'id_alat' => 'required|string',
            'jam'     => 'required|string',   // format: HH:MM:SS
            'hari'    => 'required|string',   // format: YYYY-MM-DD
        ]);

        $idAlat = $validated['id_alat'];

        // --- 2. Parse timestamp dari device ---
        try {
            $recordedAt = Carbon::createFromFormat(
                'Y-m-d H:i:s',
                $validated['hari'] . ' ' . $validated['jam']
            );
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Format jam/hari tidak valid. Gunakan hari: YYYY-MM-DD dan jam: HH:MM:SS.',
            ], 422);
        }

        // --- 3. Cari logger berdasarkan device_identifier ---
        $logger = Logger::where('device_identifier', $idAlat)->first();

        if (! $logger) {
            Log::warning('[DevicePush] Logger tidak ditemukan', ['id_alat' => $idAlat]);

            return response()->json([
                'success' => false,
                'message' => "Logger dengan id_alat '{$idAlat}' tidak ditemukan.",
            ], 404);
        }

        // --- 4. Parse semua sensor1..sensor16 dari payload, skip yang kosong ---
        $payload    = $request->all();
        $sensorData = [];

        foreach ($payload as $key => $item) {
            if (! preg_match('/^sensor\d+$/', $key)) {
                continue;
            }

            // Skip sensor kosong atau tidak punya field wajib
            if (empty($item) || ! isset($item['nama'], $item['nilai'])) {
                continue;
            }

            $sensorData[] = [
                'key'    => $key,
                'nama'   => trim($item['nama']),
                'nilai'  => (float) $item['nilai'],
                'satuan' => isset($item['satuan']) ? trim($item['satuan']) : null,
            ];
        }

        // --- 5. Update status logger → online ---
        $logger->update([
            'status'                => 'online',
            'last_data_received_at' => now(),
            'last_seen_at'          => now(),
        ]);

        // --- 6. Ambil semua sensor terdaftar untuk logger ini ---
        // Diindeks dua kali: exact (lowercase) dan array untuk partial match
        $registeredSensors = Sensor::where('logger_id', $logger->id)->get();
        $exactIndex        = $registeredSensors->keyBy(fn(Sensor $s) => strtolower(trim($s->name)));

        // --- 7. Proses setiap sensor dari device ---
        $results  = [];
        $matched  = 0;
        $unmatched = 0;

        foreach ($sensorData as $item) {
            $incomingNameLower = strtolower($item['nama']);

            // Cari sensor yang cocok: exact → partial fallback
            $registeredSensor = $this->findMatchingSensor(
                $incomingNameLower,
                $exactIndex,
                $registeredSensors
            );

            $sensorId    = $registeredSensor?->id;
            $matchMethod = null;

            if ($registeredSensor) {
                // Tentukan metode match untuk logging
                $matchMethod = (strtolower($registeredSensor->name) === $incomingNameLower)
                    ? 'exact'
                    : 'partial';

                // Update nilai terbaru di tabel sensors
                $registeredSensor->update([
                    'value'          => $item['nilai'],
                    'last_reading_at' => $recordedAt,
                    // Update unit jika sensor punya unit kosong atau null dan device mengirim unit
                    'unit'           => (empty($registeredSensor->unit) && ! empty($item['satuan']))
                        ? $item['satuan']
                        : $registeredSensor->unit,
                ]);

                $matched++;

                Log::debug('[DevicePush] Sensor matched', [
                    'key'          => $item['key'],
                    'device_nama'  => $item['nama'],
                    'db_name'      => $registeredSensor->name,
                    'match_method' => $matchMethod,
                    'nilai'        => $item['nilai'],
                    'satuan'       => $item['satuan'],
                ]);
            } else {
                $unmatched++;

                Log::debug('[DevicePush] Sensor tidak terdaftar (unmatched)', [
                    'key'  => $item['key'],
                    'nama' => $item['nama'],
                ]);
            }

            // Simpan ke histori sensor_logs (selalu, baik matched maupun tidak)
            SensorLog::create([
                'logger_id'   => $logger->id,
                'sensor_id'   => $sensorId,
                'sensor_name' => $item['nama'],
                'sensor_key'  => $item['key'],
                'value'       => $item['nilai'],
                'unit'        => $item['satuan'],
                'recorded_at' => $recordedAt,
            ]);

            $results[] = [
                'key'          => $item['key'],
                'nama'         => $item['nama'],
                'nilai'        => $item['nilai'],
                'satuan'       => $item['satuan'],
                'matched'      => $registeredSensor !== null,
                'match_method' => $matchMethod,
                'sensor_id'    => $sensorId,
                'db_name'      => $registeredSensor?->name,
            ];
        }

        Log::info('[DevicePush] Data berhasil diproses', [
            'id_alat'      => $idAlat,
            'logger_id'    => $logger->id,
            'logger_name'  => $logger->name,
            'recorded_at'  => $recordedAt->toDateTimeString(),
            'total_sensor' => count($sensorData),
            'matched'      => $matched,
            'unmatched'    => $unmatched,
        ]);

        // --- 8. Dispatch forwarding job (async, database queue) ---
        // Logger gets 200 OK immediately; forwarding runs in background.
        ForwardToIntegrations::dispatch($logger, $request->all())->onQueue('default');

        return response()->json([
            'success'     => true,
            'message'     => 'Data berhasil diterima.',
            'logger_id'   => $logger->id,
            'recorded_at' => $recordedAt->toIso8601String(),
            'summary'     => [
                'total'     => count($sensorData),
                'matched'   => $matched,
                'unmatched' => $unmatched,
            ],
            'sensors' => $results,
        ]);
    }

    /**
     * Cari sensor yang cocok dari daftar sensor terdaftar di DB.
     *
     * Strategi (berurutan, berhenti di match pertama):
     *   1. Exact match (case-insensitive)
     *   2. Partial match: DB name mengandung nama device (atau sebaliknya)
     *
     * Contoh partial match:
     *   device "TEMP_BELIMO" ↔ DB "Temp Belimo"   → match
     *   device "Humi_Logger" ↔ DB "Humidity Logger" → match (device ada di db)
     *
     * @param string     $incomingNameLower  Nama sensor dari device (sudah lowercase)
     * @param Collection $exactIndex         Koleksi sensor DB di-key-by lowercase name
     * @param Collection $allSensors         Semua sensor DB (untuk partial match)
     */
    private function findMatchingSensor(
        string $incomingNameLower,
        Collection $exactIndex,
        Collection $allSensors
    ): ?Sensor {
        // --- Strategi 1: Exact match ---
        if ($exactIndex->has($incomingNameLower)) {
            return $exactIndex->get($incomingNameLower);
        }

        // --- Strategi 2: Partial match ---
        // Normalisasi nama: hilangkan underscore/hyphen/spasi ekstra untuk perbandingan
        $incomingNormalized = $this->normalizeName($incomingNameLower);

        foreach ($allSensors as $sensor) {
            $dbNameNormalized = $this->normalizeName(strtolower(trim($sensor->name)));

            // DB name mengandung nama device (e.g. DB "Temp Belimo Logger" ↔ device "TEMP_BELIMO")
            if (str_contains($dbNameNormalized, $incomingNormalized)) {
                return $sensor;
            }

            // Nama device mengandung DB name (e.g. device "Humi_Logger_Ext" ↔ DB "Humi Logger")
            if (str_contains($incomingNormalized, $dbNameNormalized)) {
                return $sensor;
            }
        }

        return null;
    }

    /**
     * Normalisasi nama sensor untuk partial matching:
     * - Lowercase sudah dilakukan sebelumnya
     * - Hilangkan underscore, hyphen, spasi berulang → single space
     *
     * Contoh: "TEMP_BELIMO" → "temp belimo", "Temp-Belimo" → "temp belimo"
     */
    private function normalizeName(string $name): string
    {
        // Ganti underscore dan hyphen dengan spasi
        $name = str_replace(['_', '-'], ' ', $name);

        // Kompres spasi berulang
        return preg_replace('/\s+/', ' ', trim($name));
    }
}
