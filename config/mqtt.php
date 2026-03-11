<?php

return [
    'host' => env('MQTT_HOST', 'mqtt.beacontelemetry.com'),
    'port' => (int) env('MQTT_PORT', 8383),
    'username' => env('MQTT_USERNAME', 'userlog'),
    'password' => env('MQTT_PASSWORD', 'b34c0n'),
    'client_id_prefix' => env('MQTT_CLIENT_PREFIX', 'cloud_beacon_'),
    'timeout' => (int) env('MQTT_TIMEOUT', 30), // seconds to wait for response
];
