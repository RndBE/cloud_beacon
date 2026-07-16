<?php

namespace App\Services;

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
            if (! is_string($cidr)) {
                continue;
            }

            $cidr = trim($cidr);

            if (! $this->validIpv4Cidr($cidr)) {
                continue;
            }

            if (IpUtils::checkIp($host, $cidr)) {
                return true;
            }
        }

        return false;
    }

    private function validIpv4Cidr(string $cidr): bool
    {
        [$address, $prefix] = array_pad(explode('/', $cidr, 2), 2, null);

        if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return false;
        }

        if ($prefix === null) {
            return true;
        }

        return $prefix !== ''
            && ctype_digit($prefix)
            && (int) $prefix <= 32;
    }
}
