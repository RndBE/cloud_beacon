<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cloud SSH — Web Terminal Bridge
    |--------------------------------------------------------------------------
    |
    | The ssh-bridge Node service (see ssh-bridge/ in the repo root) exchanges
    | one-time session tokens for SSH connection parameters through an internal
    | endpoint protected by this shared secret.
    |
    */

    // Shared secret between Laravel and the ssh-bridge service.
    'bridge_secret' => env('CLOUD_SSH_BRIDGE_SECRET', ''),

    // Public WebSocket path the browser connects to (proxied by nginx to the bridge).
    'ws_path' => env('CLOUD_SSH_WS_PATH', '/cloud-ssh/ws'),

    // Seconds a session token stays valid before the bridge must redeem it.
    'token_ttl' => env('CLOUD_SSH_TOKEN_TTL', 30),
];
