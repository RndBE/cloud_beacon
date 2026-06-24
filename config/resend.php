<?php
// config/resend.php
return [
    // Estimasi detik per resend yang masih in-flight (queue 'default' ~instan).
    'interval'    => (int) env('RESEND_ETA_INTERVAL', 2),
    // Setelah sekian detik tanpa baris anak, sebuah resend dianggap gagal (job ke-skip/guard).
    'stale_after' => (int) env('RESEND_STALE_AFTER', 300),
];
