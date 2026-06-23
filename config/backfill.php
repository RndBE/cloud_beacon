<?php

return [
    'interval'        => (int) env('BACKFILL_INTERVAL', 10),
    'ack_timeout'     => (int) env('BACKFILL_ACK_TIMEOUT', 10),
    'confirm_timeout' => (int) env('BACKFILL_CONFIRM_TIMEOUT', 15),
    'max_attempts'    => (int) env('BACKFILL_MAX_ATTEMPTS', 3),
    'queue'           => env('BACKFILL_QUEUE', 'backfill'),
];
