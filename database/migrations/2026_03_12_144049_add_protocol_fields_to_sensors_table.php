<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('sensors', function (Blueprint $table) {
            $table->string('connection_type')->nullable()->after('type');          // rs485, rs232, analog
            $table->unsignedTinyInteger('modbus_slave_id')->nullable()->after('connection_type');
            $table->string('device_name', 50)->nullable()->after('modbus_slave_id');
            $table->unsignedTinyInteger('function_code')->nullable()->after('device_name');
            $table->unsignedInteger('register_address')->nullable()->after('function_code');
            $table->unsignedTinyInteger('quantity')->nullable()->after('register_address');
            $table->decimal('scale_factor', 10, 6)->nullable()->after('quantity');
            $table->unsignedTinyInteger('channel')->nullable()->after('scale_factor');   // analog ch
            $table->unsignedTinyInteger('port')->nullable()->after('channel');            // rs232 port
            $table->boolean('lcd_enabled')->default(true)->after('port');
            $table->boolean('log_enabled')->default(true)->after('lcd_enabled');
            $table->boolean('send_enabled')->default(true)->after('log_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('sensors', function (Blueprint $table) {
            $table->dropColumn([
                'connection_type', 'modbus_slave_id', 'device_name',
                'function_code', 'register_address', 'quantity',
                'scale_factor', 'channel', 'port',
                'lcd_enabled', 'log_enabled', 'send_enabled',
            ]);
        });
    }
};
