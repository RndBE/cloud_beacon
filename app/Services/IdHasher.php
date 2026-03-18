<?php

namespace App\Services;

use Hashids\Hashids;

class IdHasher
{
    private static ?Hashids $instance = null;

    private static function hashids(): Hashids
    {
        if (!self::$instance) {
            self::$instance = new Hashids(config('app.key'), 8);
        }
        return self::$instance;
    }

    /**
     * Encode an integer ID to a URL-safe hash string.
     */
    public static function encode(int $id): string
    {
        return self::hashids()->encode($id);
    }

    /**
     * Decode a hash string back to an integer ID.
     * Returns null if invalid.
     */
    public static function decode(string $hash): ?int
    {
        $decoded = self::hashids()->decode($hash);
        return !empty($decoded) ? $decoded[0] : null;
    }
}
