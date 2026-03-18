<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->string('ftp_host')->nullable()->after('ministesy_interval');
            $table->unsignedSmallInteger('ftp_port')->default(21)->after('ftp_host');
            $table->string('ftp_user')->nullable()->after('ftp_port');
            $table->string('ftp_pass')->nullable()->after('ftp_user');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['ftp_host', 'ftp_port', 'ftp_user', 'ftp_pass']);
        });
    }
};
