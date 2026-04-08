<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Represents a row in the `t_logger` table on the `mysql_second` (db_mqttserver) database.
 *
 * Columns:
 *  - id            : int, auto increment PK
 *  - idlogger      : varchar(10) — the device's serial number / identifier
 *  - url_input     : text        — the HTTP endpoint the MQTT server will push data to
 *  - user          : varchar(30) — friendly label; we use the serial number
 *  - content_type  : text        — e.g. 'application/json'
 */
class MqttLogger extends Model
{
    protected $connection = 'mysql_second';

    protected $table = 't_logger';

    public $timestamps = false;

    protected $fillable = [
        'idlogger',
        'url_input',
        'user',
        'content_type',
    ];
}
