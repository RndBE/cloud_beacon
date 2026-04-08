<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeviceModel extends Model
{
    protected $fillable = [
        'name',
        'description',
        'channel_count',
        'image',
    ];
}
