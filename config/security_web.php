<?php

/*
 * Website side of the Security System modules.
 *
 * device_password: the console password the firmware checks on every setting change
 * (atur protocol). The server signs website commands with it, so users never type
 * it; it never reaches the browser. All units share it (set at production).
 */
return [
    'device_password' => env('SECURITY_DEVICE_PASSWORD'),
];
