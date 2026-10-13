<?php

namespace App\Services;

/**
 * Signs a Security System "atur" (SET) command on the server, so website users never
 * handle the device password. Must match the firmware exactly
 * (D:\Security System\RFID\src\main.cpp, "KONFIGURASI LEWAT MQTT"):
 *   K     = SHA256(salt || password)
 *   plain = op 0x1F a 0x1F b
 *   block i of the keystream = SHA256(K || "SSA1" || nonce || uint32BE(i))
 *   data  = plain XOR keystream
 *   mac   = HMAC-SHA256(K, nonce || data)
 */
class SecurityAturSigner
{
    /** @return array{nonce: string, data: string, mac: string} hex, as the SET payload expects */
    public static function sign(string $saltHex, string $nonceHex, string $password, string $op, string $a = '', string $b = ''): array
    {
        $key = hash('sha256', hex2bin($saltHex).$password, true);
        $nonce = hex2bin($nonceHex);
        $plain = $op."\x1f".$a."\x1f".$b;

        $data = '';
        for ($i = 0; $i < strlen($plain); $i++) {
            if ($i % 32 === 0) {
                $block = hash('sha256', $key.'SSA1'.$nonce.pack('N', intdiv($i, 32)), true);
            }
            $data .= $plain[$i] ^ $block[$i % 32];
        }

        return [
            'nonce' => $nonceHex,
            'data' => bin2hex($data),
            'mac' => hash_hmac('sha256', $nonce.$data, $key),
        ];
    }
}
