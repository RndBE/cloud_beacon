<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Remote SSH Server for Service Management
    |--------------------------------------------------------------------------
    |
    | Used to restart systemd services (e.g. MQTT broker) after logger changes.
    |
    */

    'host'             => env('SSH_HOST', ''),
    'user'             => env('SSH_USER', 'root'),
    'port'             => env('SSH_PORT', 22),

    // Path to private key file on THIS server (the Laravel app server).
    // Example: storage_path('app/ssh/id_rsa')
    'private_key_path' => env('SSH_PRIVATE_KEY_PATH', ''),

    // Service name(s) to restart — comma-separated if multiple
    'mqtt_service'     => env('SSH_MQTT_SERVICE', 'mosquitto'),

];
