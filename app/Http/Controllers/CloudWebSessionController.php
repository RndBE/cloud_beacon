<?php

namespace App\Http\Controllers;

use App\Models\RemoteDevice;
use App\Services\CloudWebTargetPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class CloudWebSessionController extends Controller
{
    public function __construct(private readonly CloudWebTargetPolicy $targetPolicy) {}

    public function store(Request $request, RemoteDevice $device): JsonResponse
    {
        $startedAt = hrtime(true);
        $userId = (int) $request->user()->getAuthIdentifier();
        $slug = is_string($device->web_slug) ? $device->web_slug : null;

        if ($request->user()->email_verified_at === null) {
            $this->audit($startedAt, $userId, $device->id, $slug, 'unverified');

            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if (! $device->web_enabled) {
            return $this->unavailable($startedAt, $userId, $device->id, $slug, 'disabled');
        }

        if (! $this->validSlug($slug)) {
            return $this->unavailable($startedAt, $userId, $device->id, $slug, 'invalid_slug');
        }

        if (! $this->targetPolicy->allows($device->host, $device->web_port)) {
            return $this->unavailable($startedAt, $userId, $device->id, $slug, 'target_denied');
        }

        $token = bin2hex(random_bytes(32));

        Cache::put('cloud-web:token:'.$token, [
            'device_id' => $device->id,
            'user_id' => $userId,
            'host' => $device->host,
            'web_port' => $device->web_port,
            'web_slug' => $slug,
        ], now()->addSeconds((int) config('cloud-web.token_ttl')));

        $this->audit($startedAt, $userId, $device->id, $slug, 'issued');

        return response()->json([
            'url' => 'https://'.$slug.'.'.config('cloud-web.base_domain').'/_cloud-web/connect?token='.$token,
        ], 200, ['Cache-Control' => 'no-store']);
    }

    private function unavailable(
        int $startedAt,
        int $userId,
        int $deviceId,
        ?string $slug,
        string $status,
    ): JsonResponse {
        $this->audit($startedAt, $userId, $deviceId, $slug, $status);

        return response()->json(['message' => 'Cloud web access is unavailable.'], 422);
    }

    private function validSlug(?string $slug): bool
    {
        return $slug !== null && preg_match('/^device-[a-z0-9-]+$/D', $slug) === 1;
    }

    private function audit(
        int $startedAt,
        ?int $userId,
        ?int $deviceId,
        ?string $slug,
        string $status,
    ): void {
        Log::info('Cloud Web access audit.', [
            'event' => 'cloud_web.issue',
            'user_id' => $userId,
            'device_id' => $deviceId,
            'slug' => $slug,
            'status' => $status,
            'duration_ms' => intdiv(max(0, hrtime(true) - $startedAt), 1_000_000),
        ]);
    }
}
