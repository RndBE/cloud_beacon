<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityCommandException;
use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use App\Services\IdHasher;
use App\Services\SecurityCommandService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Halaman Production > Security System > <ID>: keadaan alat, foto terakhir,
 * log kejadian, dan kartu terdaftar. Konfigurasinya (pasang/lepas, kelola
 * kartu) ada di tab Security Cam halaman logger.
 *
 * Foto dan log keamanan milik stasiun, jadi aksesnya mengikuti logger tempat
 * alat dipasang (visibleTo). Unit stok hanya untuk pemegang production.view.
 * Foto dibuka lewat URL bertanda tangan dari SecurityPhoto::temporaryUrl(),
 * yang hanya diberikan setelah akses itu lolos dicek.
 */
class SecurityDeviceStatusController extends Controller
{
    private const EVENT_LIMIT = 50;

    // The page reuses a signed URL for 8 minutes (URL_REUSE_MS in security-device-view.tsx),
    // so this must stay longer than that.
    private const PHOTO_URL_MINUTES = 10;

    // Kamera memotret sesudah pembobolan terdeteksi; foto dalam jendela ini dianggap fotonya.
    // Jendela dimulai sedikit sebelum kejadian karena jam papan dan jam kamera bisa selisih.
    private const BREACH_PHOTO_BEFORE_SECONDS = 10;

    private const BREACH_PHOTO_AFTER_SECONDS = 60;

    public function show(string $deviceId): Response
    {
        $device = $this->device($deviceId);

        return Inertia::render('production/security-device', [
            'deviceId' => $device->device_id,
            'name' => $device->name,
            'logger' => $device->logger ? [
                'id' => IdHasher::encode($device->logger->id),
                'name' => $device->logger->name,
                'serialNumber' => $device->logger->serial_number,
            ] : null,
        ]);
    }

    public function data(string $deviceId): JsonResponse
    {
        $device = $this->device($deviceId);

        // Sort by the time the page shows: an event logged before the device clock synced
        // has occurred_at near 1970 and would otherwise sink below the limit.
        $events = $device->events()
            ->orderByRaw('CASE WHEN time_valid THEN occurred_at ELSE received_at END DESC')
            ->orderByDesc('id')
            ->limit(self::EVENT_LIMIT)
            ->get();

        // Only the newest photo is shown on its own; older ones are reached through
        // the FOTO / PEMBOBOLAN rows of the event list.
        $latestPhoto = $device->photos()
            ->where('complete', true)
            ->orderByDesc('captured_at')
            ->orderByDesc('id')
            ->first();

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
            'latestPhoto' => $latestPhoto ? $this->photoJson($device, $latestPhoto) : null,
        ]);
    }

    // Read-only card list straight from the device; changing cards is in the logger tab.
    public function cards(string $deviceId, SecurityCommandService $commands): JsonResponse
    {
        $device = $this->device($deviceId);

        try {
            $reply = $commands->request($device, ['SECURITY' => ['cmd' => 'GET']]);
        } catch (SecurityCommandException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        if (! is_array($reply) || ($reply['status'] ?? '') !== 'OK') {
            return response()->json([
                'message' => "Alat {$device->device_id} tidak menjawab. Pastikan alat online lalu coba lagi.",
            ], 422);
        }

        return response()->json([
            'cards' => array_values((array) ($reply['kartu_uid'] ?? [])),
            'maxCards' => $reply['maks_kartu'] ?? null,
        ]);
    }

    private function device(string $deviceId): SecurityDevice
    {
        $device = SecurityDevice::with('logger:id,name,serial_number')->where('device_id', $deviceId)->firstOrFail();
        $user = auth()->user();

        if ($device->logger_id === null) {
            abort_unless($user->hasPermission('production.view'), 403);
        } else {
            abort_unless(Logger::query()->visibleTo($user)->whereKey($device->logger_id)->exists(), 404);
        }

        return $device;
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
            'capturedAt' => $photo->captured_at?->toIso8601String(),
            'url' => $photo->temporaryUrl(self::PHOTO_URL_MINUTES),
        ];
    }
}
