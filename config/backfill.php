<?php

return [
    'interval'        => (int) env('BACKFILL_INTERVAL', 1),
    'ack_timeout'     => (int) env('BACKFILL_ACK_TIMEOUT', 10),
    'confirm_timeout' => (int) env('BACKFILL_CONFIRM_TIMEOUT', 15),
    'max_attempts'    => (int) env('BACKFILL_MAX_ATTEMPTS', 3),
    'queue'           => env('BACKFILL_QUEUE', 'backfill'),
    // Detik tanpa kemajuan sebelum satu batch replay dianggap terlantar,
    // sehingga UI berhenti menampilkannya sebagai sedang berjalan.
    'replay_stale_after' => (int) env('REPLAY_STALE_AFTER', 300),
];
