<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\MqttService;
use Illuminate\Support\Facades\Bus;

it('marks a task filled when ack OK and the minute lands, then re-dispatches', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $logger = Logger::factory()->create(['device_identifier' => 'BL-TEST']);

    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:08:00', 'status' => 'pending']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:09:00', 'status' => 'pending']);

    // Simulate device: ack OK and the resent sample already present.
    $this->mock(MqttService::class, function ($m) {
        $m->shouldReceive('sendResend')->andReturn(['success' => true, 'status' => 'OK', 'message' => 'ok']);
    });
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-22 08:08:00',
    ]);

    (new RunLoggerBackfill($logger))->handle(app(MqttService::class));

    expect(DataBackfillTask::where('minute', '2026-06-22 08:08:00')->first()->status)->toBe('filled');
    Bus::assertDispatched(RunLoggerBackfill::class); // one pending remains → re-dispatched
});

it('short-circuits the whole day to no_file on a NO_FILE ack', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $logger = Logger::factory()->create(['device_identifier' => 'BL-TEST']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:08:00', 'status' => 'pending']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:30:00', 'status' => 'pending']);

    $this->mock(MqttService::class, function ($m) {
        $m->shouldReceive('sendResend')->andReturn(['success' => false, 'status' => 'NO_FILE', 'message' => 'no file']);
    });

    (new RunLoggerBackfill($logger))->handle(app(MqttService::class));

    expect(DataBackfillTask::where('logger_id', $logger->id)->where('status', 'no_file')->count())->toBe(2);
    Bus::assertNotDispatched(RunLoggerBackfill::class); // nothing pending left
});
