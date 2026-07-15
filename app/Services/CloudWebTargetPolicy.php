<?php

namespace App\Services;

use InvalidArgumentException;
use Symfony\Component\HttpFoundation\IpUtils;

final class CloudWebTargetPolicy
{
    public function allows(string $host, int $port): bool
    {
        if ($port < 1 || $port > 65535) {
            return false;
        }

        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return false;
        }

        foreach ((array) config('cloud-web.allowed_cidrs', []) as $cidr) {
            if (! is_string($cidr) || trim($cidr) === '') {
                continue;
            }

            try {
                if (IpUtils::checkIp($host, $cidr)) {
                    return true;
                }
            } catch (InvalidArgumentException) {
                // Fail closed when an allowed CIDR is malformed.
            }
        }

        return false;
    }
}
