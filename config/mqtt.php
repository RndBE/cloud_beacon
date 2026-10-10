<?php

return [
    'host' => env('MQTT_HOST', 'mqtt.beacontelemetry.com'),
    'port' => (int) env('MQTT_PORT', 8383),
    'username' => env('MQTT_USERNAME', 'userlog'),
    'password' => env('MQTT_PASSWORD', 'b34c0n'),
    'client_id_prefix' => env('MQTT_CLIENT_PREFIX', 'cloud_beacon_'),
    'timeout'     => (int) env('MQTT_TIMEOUT', 15),      // seconds to wait for regular MQTT response
    'gcm_set_timeout' => (int) env('MQTT_GCM_SET_TIMEOUT', 45), // GCM SET: logger talks to each bound module before replying
    'ftp_timeout' => (int) env('MQTT_FTP_TIMEOUT', 300), // seconds to wait for FTP (upload can be slow)
];
