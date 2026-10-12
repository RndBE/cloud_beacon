<?php

/*
 * Alat Security System (alarm pintu RFID + ESP32-CAM).
 *
 * Alat ini bicara lewat broker MQTT yang sama dengan logger, dengan pasangan
 * topik sub_<id> (perintah ke alat) dan pub_<id> (laporan dari alat).
 * Pendengarnya: php artisan security:listen.
 *
 * Broker diberi setelan sendiri karena .env pengembangan lokal sering
 * mengarahkan MQTT_* ke broker lokal, sedangkan alat uji selalu terbit ke
 * broker kantor. Kalau SECURITY_MQTT_* kosong, setelan MQTT_* yang dipakai.
 */
return [
    'mqtt' => [
        'host' => env('SECURITY_MQTT_HOST', env('MQTT_HOST', 'mqtt.beacontelemetry.com')),
        'port' => (int) env('SECURITY_MQTT_PORT', env('MQTT_PORT', 8383)),
        'username' => env('SECURITY_MQTT_USERNAME', env('MQTT_USERNAME', 'userlog')),
        'password' => env('SECURITY_MQTT_PASSWORD', env('MQTT_PASSWORD')),
        'client_id_prefix' => env('MQTT_CLIENT_PREFIX', 'cloud_beacon_').'security_',
    ],

    // Daftar alat dibaca ulang dari database sesering ini, supaya alat yang
    // baru didaftarkan langsung didengar tanpa me-restart pendengar.
    'refresh_seconds' => (int) env('SECURITY_REFRESH_SECONDS', 60),

    // Meminta kamera mengirim ulang foto yang tidak lengkap. Hanya SATU
    // pendengar per broker yang boleh menyalakannya: pendengar lokal saat
    // pengembangan dan pendengar server sama-sama akan meminta, sehingga
    // kamera mengirim dua kali. Matikan di .env lokal: SECURITY_RESEND=false.
    'resend_enabled' => (bool) env('SECURITY_RESEND', true),

    // Lama teknisi boleh menempelkan kartu setelah menekan "Pasang alat".
    'pairing_seconds' => (int) env('SECURITY_PAIRING_SECONDS', 30),

    // Alat mengirim telemetri tiap 60 detik. Tiga kali terlewat = offline.
    'offline_after_seconds' => (int) env('SECURITY_OFFLINE_AFTER', 180),
];
