<?php

return [
    'base_domain' => env('CLOUD_WEB_BASE_DOMAIN', 'be-stesy.cloud'),
    'bridge_secret' => env('CLOUD_WEB_BRIDGE_SECRET', ''),
    'token_ttl' => (int) env('CLOUD_WEB_TOKEN_TTL', 30),
    'allowed_cidrs' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CLOUD_WEB_ALLOWED_CIDR', '10.8.0.0/24')),
    ))),
];
