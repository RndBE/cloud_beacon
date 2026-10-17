<?php

namespace App\Exceptions;

use RuntimeException;

/** Perintah ke alat Security System tidak bisa dikirim (misalnya broker tak terjangkau). */
class SecurityCommandException extends RuntimeException {}
