<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Latest firmware file for one module model, like a logger model's OTA firmware. */
class ModuleFirmware extends Model
{
    // Only modules that take OTA updates; EWS and GCM have none.
    public const MODELS = ['Security System'];

    // Laravel treats "firmware" as uncountable and would look for module_firmware.
    protected $table = 'module_firmwares';

    protected $fillable = [
        'model',
        'firmware_version',
        'file_path',
        'file_name',
        'file_size',
        'uploaded_by',
    ];
}
