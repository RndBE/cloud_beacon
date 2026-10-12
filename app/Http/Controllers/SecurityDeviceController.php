<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use App\Services\IdHasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

/**
 * Data tab Security Cam di halaman logger: alat Security System yang dipasang
 * di logger ini (lihat php artisan security:device) beserta kejadian dan foto
 * terbarunya. Hanya membaca; data ditulis oleh pendengar security:listen.
 *
 * Foto dibuka lewat URL bertanda tangan dari SecurityPhoto::temporaryUrl(),
 * yang hanya diberikan setelah akses ke logger ini lolos dicek.
 */
class SecurityDeviceController extends Controller
{
    private const EVENT_LIMIT = 50;

    private const PHOTO_LIMIT = 12;

    // The tab reuses a signed URL for 8 minutes (URL_REUSE_MS in security-cam-card.tsx),
    // so this must stay longer than that.
    private const PHOTO_URL_MINUTES = 10;

    // Kamera memotret sesudah pembobolan terdeteksi; foto dalam jendela ini dianggap fotonya.
    // Jendela dimulai sedikit sebelum kejadian karena jam papan dan jam kamera bisa selisih.
    private const BREACH_PHOTO_BEFORE_SECONDS = 10;

    private const BREACH_PHOTO_AFTER_SECONDS = 60;

    public function show(string $hash): JsonResponse
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $logger = Logger::query()->visibleTo(auth()->user())->findOrFail($id);
        $device = SecurityDevice::where('logger_id', $logger->id)->first();

        if ($device === null) {
            return response()->json(['device' => null, 'events' => [], 'photos' => []]);
        }

        // Sort by the time the tab shows: an event logged before the device clock synced
        // has occurred_at near 1970 and would otherwise sink below the limit.
        $events = $device->events()
            ->orderByRaw('CASE WHEN time_valid THEN occurred_at ELSE received_at END DESC')
            ->orderByDesc('id')
            ->limit(self::EVENT_LIMIT)
            ->get();

        $photos = $device->photos()
            ->orderByDesc('captured_at')
            ->orderByDesc('id')
            ->limit(self::PHOTO_LIMIT)
            ->get();

        $eventPhotos = $this->photosForEvents($device, $events);

        return response()->json([
            'device' => [
                'deviceId' => $device->device_id,
                'name' => $device->name,
                'online' => $device->isOnline(),
                'lastSeenAt' => $device->last_seen_at?->toIso8601String(),
                'status' => $device->last_status,
            ],
            'events' => $events->map(fn (SecurityEvent $event) => [
                'id' => $event->id,
                'type' => $event->type,
                'detail' => $event->detail,
                'occurredAt' => $event->occurred_at?->toIso8601String(),
                'timeValid' => $event->time_valid,
                'receivedAt' => $event->received_at->toIso8601String(),
                'photo' => isset($eventPhotos[$event->id])
                    ? $this->photoJson($device, $eventPhotos[$event->id])
                    : null,
            ]),
            'photos' => $photos->map(fn (SecurityPhoto $photo) => $this->photoJson($device, $photo)),
        ]);
    }

    /**
     * FOTO events carry the photo's file name as detail. A PEMBOBOLAN event gets the
     * photo taken closest to it within its window. FOTO_ULANG is only a resend of an
     * existing photo, so it gets none.
     *
     * @param  Collection<int, SecurityEvent>  $events
     * @return array<int, SecurityPhoto> keyed by event id
     */
    private function photosForEvents(SecurityDevice $device, Collection $events): array
    {
        $result = [];

        $fotoEvents = $events->where('type', 'FOTO')->filter(fn (SecurityEvent $e) => $e->detail);
        if ($fotoEvents->isNotEmpty()) {
            $byName = $device->photos()
                ->where('complete', true)
                ->whereIn('name', $fotoEvents->pluck('detail')->unique())
                ->get()
                ->keyBy('name');
            foreach ($fotoEvents as $event) {
                if ($photo = $byName->get($event->detail)) {
                    $result[$event->id] = $photo;
                }
            }
        }

        $breaches = $events->where('type', 'PEMBOBOLAN')
            ->filter(fn (SecurityEvent $e) => $e->time_valid && $e->occurred_at);
        if ($breaches->isNotEmpty()) {
            $candidates = $device->photos()
                ->where('complete', true)
                ->whereBetween('captured_at', [
                    $breaches->min('occurred_at')->copy()->subSeconds(self::BREACH_PHOTO_BEFORE_SECONDS),
                    $breaches->max('occurred_at')->copy()->addSeconds(self::BREACH_PHOTO_AFTER_SECONDS),
                ])
                ->get();
            foreach ($breaches as $event) {
                $from = $event->occurred_at->copy()->subSeconds(self::BREACH_PHOTO_BEFORE_SECONDS);
                $until = $event->occurred_at->copy()->addSeconds(self::BREACH_PHOTO_AFTER_SECONDS);
                $photo = $candidates
                    ->filter(fn (SecurityPhoto $p) => $p->captured_at->between($from, $until))
                    ->sortBy(fn (SecurityPhoto $p) => abs($p->captured_at->diffInSeconds($event->occurred_at)))
                    ->first();
                if ($photo) {
                    $result[$event->id] = $photo;
                }
            }
        }

        return $result;
    }

    private function photoJson(SecurityDevice $device, SecurityPhoto $photo): array
    {
        return [
            'id' => $photo->id,
            'name' => $photo->name,
            'downloadName' => $device->device_id.'_'.ltrim(basename($photo->name), '/'),
            'size' => $photo->size,
            'complete' => $photo->complete,
            'chunksReceived' => $photo->chunks_received,
            'chunksExpected' => $photo->chunks_expected,
            'capturedAt' => $photo->captured_at?->toIso8601String(),
            'url' => $photo->temporaryUrl(self::PHOTO_URL_MINUTES),
        ];
    }
}
