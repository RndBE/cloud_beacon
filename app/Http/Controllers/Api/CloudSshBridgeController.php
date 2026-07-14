<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Internal endpoint for the ssh-bridge service: redeems a one-time session
 * token for SSH connection parameters. Protected by a shared secret header,
 * never exposed to browsers.
 */
class CloudSshBridgeController extends Controller
{
    public function validateToken(Request $request): JsonResponse
    {
        $secret = (string) config('cloud-ssh.bridge_secret');

        if ($secret === '' || !hash_equals($secret, (string) $request->header('X-Bridge-Secret'))) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $token = (string) $request->input('token');

        if ($token === '') {
            return response()->json(['message' => 'Token required.'], 422);
        }

        // pull() = single use: the token disappears the moment it is redeemed.
        $session = Cache::pull('cloud-ssh:token:' . $token);

        if ($session === null) {
            return response()->json(['message' => 'Invalid or expired token.'], 404);
        }

        return response()->json($session);
    }
}
