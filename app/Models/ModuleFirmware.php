<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Latest firmware files for one module model, like a logger model's OTA firmware. */
class ModuleFirmware extends Model
{
    // Only modules that take firmware from the website; EWS and GCM have none. The
    // Security System is two boards: the main ESP32-S3 and its ESP32-CAM.
    public const MODELS = ['Security System', 'Security System Kamera'];

    // Laravel treats "firmware" as uncountable and would look for module_firmware.
    protected $table = 'module_firmwares';

    protected $fillable = [
        'model',
        'firmware_version',
        'file_path',
        'file_name',
        'file_size',
        'factory_path',
        'factory_name',
        'factory_size',
        'uploaded_by',
    ];
}
