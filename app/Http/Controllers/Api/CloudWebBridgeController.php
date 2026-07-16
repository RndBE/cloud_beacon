<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\RemoteDevice;
use App\Services\CloudWebTargetPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class CloudWebBridgeController extends Controller
{
    public function __construct(private readonly CloudWebTargetPolicy $targetPolicy) {}

    public function validateToken(Request $request): JsonResponse
    {
        $startedAt = hrtime(true);
        $secret = (string) config('cloud-web.bridge_secret');
        $providedSecret = $request->header('X-Cloud-Web-Bridge-Secret');

        if (! is_string($providedSecret)) {
            $providedSecret = '';
        }

        if ($secret === '' || ! hash_equals($secret, $providedSecret)) {
            return $this->error($startedAt, 'forbidden', 403, 'Forbidden.');
        }

        $token = $request->input('token');

        if (! is_string($token) || preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) {
            return $this->error($startedAt, 'invalid_token', 422, 'Invalid token format.');
        }

        if (! Cache::add(
            'cloud-web:claim:'.$token,
            true,
            now()->addSeconds((int) config('cloud-web.token_ttl')),
        )) {
            return $this->error($startedAt, 'already_claimed', 404, 'Invalid or expired token.');
        }

        $session = Cache::pull('cloud-web:token:'.$token);

        if (! is_array($session)) {
            return $this->error($startedAt, 'missing', 404, 'Invalid or expired token.');
        }

        $deviceId = $session['device_id'] ?? null;
        $userId = $session['user_id'] ?? null;
        $slug = $session['web_slug'] ?? null;
        $device = is_int($deviceId) ? RemoteDevice::query()->find($deviceId) : null;

        if (! is_int($userId)
            || ! is_string($slug)
            || ! $device instanceof RemoteDevice
            || ! $this->matchesCurrentState($session, $device)) {
            return $this->error(
                $startedAt,
                'stale',
                404,
                'Invalid or expired token.',
                is_int($userId) ? $userId : null,
                is_int($deviceId) ? $deviceId : null,
                is_string($slug) ? $slug : null,
            );
        }

        $this->audit($startedAt, $userId, $device->id, $slug, 'redeemed');

        return response()->json([
            'device_id' => $device->id,
            'user_id' => $userId,
            'host' => $device->host,
            'port' => $device->web_port,
            'web_slug' => $slug,
        ]);
    }

    /**
     * @param  array<string, mixed>  $session
     */
    private function matchesCurrentState(array $session, RemoteDevice $device): bool
    {
        $slug = is_string($device->web_slug) ? $device->web_slug : null;

        return $device->web_enabled
            && $slug !== null
            && preg_match('/^device-[a-z0-9-]+$/D', $slug) === 1
            && ($session['device_id'] ?? null) === $device->id
            && ($session['host'] ?? null) === $device->host
            && ($session['web_port'] ?? null) === $device->web_port
            && ($session['web_slug'] ?? null) === $slug
            && $this->targetPolicy->allows($device->host, $device->web_port);
    }

    private function error(
        int $startedAt,
        string $status,
        int $httpStatus,
        string $message,
        ?int $userId = null,
        ?int $deviceId = null,
        ?string $slug = null,
    ): JsonResponse {
        $this->audit($startedAt, $userId, $deviceId, $slug, $status);

        return response()->json(['message' => $message], $httpStatus);
    }

    private function audit(
        int $startedAt,
        ?int $userId,
        ?int $deviceId,
        ?string $slug,
        string $status,
    ): void {
        Log::info('Cloud Web access audit.', [
            'event' => 'cloud_web.redeem',
            'user_id' => $userId,
            'device_id' => $deviceId,
            'slug' => $slug,
            'status' => $status,
            'duration_ms' => intdiv(max(0, hrtime(true) - $startedAt), 1_000_000),
        ]);
    }
}
