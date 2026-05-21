<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class MqttCredentialController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [
                'host' => config('mqtt.host'),
                'port' => (int) config('mqtt.port'),
                'username' => config('mqtt.username'),
                'password' => config('mqtt.password'),
                'clientIdPrefix' => config('mqtt.client_id_prefix', 'cloud_beacon_'),
                'publishTopicPrefix' => 'sub_',
                'subscribeTopicPrefix' => 'pub_',
                'timeoutSeconds' => (int) config('mqtt.timeout', 15),
            ],
        ]);
    }
}
