<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Pemasangan alat Security System tidak bisa dimulai. reason() adalah kode
 * tetap untuk UI; getMessage() penjelasannya dalam bahasa Indonesia.
 */
class SecurityPairingException extends RuntimeException
{
    public const TIDAK_TERDAFTAR = 'tidak_terdaftar';

    public const OFFLINE = 'offline';

    public const SUDAH_DIPASANG = 'sudah_dipasang';

    public const LOGGER_SUDAH_PUNYA = 'logger_sudah_punya';

    public const SEDANG_DIPASANG = 'sedang_dipasang';

    public const ID_TIDAK_SAH = 'id_tidak_sah';

    public function __construct(private string $alasan, string $pesan)
    {
        parent::__construct($pesan);
    }

    public function reason(): string
    {
        return $this->alasan;
    }
}
