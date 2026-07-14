<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RemoteDevice extends Model
{
    protected $fillable = [
        'name',
        'host',
        'port',
        'username',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'port' => 'integer',
        ];
    }
}
