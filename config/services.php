<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // AI assistant chat (resources/js/lib/assistant-chat.ts). Any OpenAI-compatible
    // API; by default the 9router combo alias on Server 3, same as go-hidro Copilot.
    'assistant' => [
        'base_url' => env('ASSISTANT_BASE_URL', 'https://router.be-stesy.cloud/v1'),
        'model' => env('ASSISTANT_MODEL', 'Chatbot'),
        'api_key' => env('ASSISTANT_API_KEY'),
        'max_tokens' => (int) env('ASSISTANT_MAX_TOKENS', 4096),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
