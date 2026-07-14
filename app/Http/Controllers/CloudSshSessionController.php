<?php

namespace App\Http\Controllers;

use App\Models\RemoteDevice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class CloudSshSessionController extends Controller
{
    /**
     * Full-page terminal for a device.
     */
    public function terminal(RemoteDevice $device): Response
    {
        return Inertia::render('cloud-ssh/terminal', [
            'device' => [
                'id'       => $device->id,
                'name'     => $device->name,
                'host'     => $device->host,
                'port'     => $device->port,
                'username' => $device->username,
            ],
            'wsPath' => config('cloud-ssh.ws_path'),
        ]);
    }

    /**
     * Issue a one-time token the browser hands to the ssh-bridge WebSocket.
     */
    public function store(Request $request, RemoteDevice $device): JsonResponse
    {
        $token = Str::random(64);

        Cache::put(
            'cloud-ssh:token:' . $token,
            [
                'device_id' => $device->id,
                'user_id'   => $request->user()->id,
                'host'      => $device->host,
                'port'      => $device->port,
                'username'  => $device->username,
            ],
            now()->addSeconds((int) config('cloud-ssh.token_ttl')),
        );

        \Log::info(sprintf(
            '[CloudSSH] user #%d (%s) opened session to device #%d (%s@%s:%d)',
            $request->user()->id,
            $request->user()->email,
            $device->id,
            $device->username,
            $device->host,
            $device->port,
        ));

        return response()->json([
            'token'   => $token,
            'ws_path' => config('cloud-ssh.ws_path'),
        ]);
    }
}
