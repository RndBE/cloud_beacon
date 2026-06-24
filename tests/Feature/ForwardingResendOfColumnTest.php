<?php
// tests/Feature/ForwardingResendOfColumnTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;

it('persists resend_of and exposes the parent/children relations', function () {
    $logger = Logger::factory()->create();

    $parent = ForwardingLog::create([
        'logger_id'   => $logger->id,
        'target_name' => 'Platform A',
        'target_url'  => 'https://platform.test/ingest',
        'status'      => 'error',
        'raw_payload' => ['id_alat' => 'X', 'jam' => '10:00:00'],
        'created_at'  => now(),
    ]);

    $child = ForwardingLog::create([
        'logger_id'   => $logger->id,
        'target_name' => 'Platform A',
        'target_url'  => 'https://platform.test/ingest',
        'status'      => 'success',
        'resend_of'   => $parent->id,
        'created_at'  => now(),
    ]);

    expect($child->resendOf->id)->toBe($parent->id);
    expect($parent->resends->pluck('id')->all())->toBe([$child->id]);
});
