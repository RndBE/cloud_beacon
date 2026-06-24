<?php
// tests/Feature/ForwardingResendEndpointTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

it('dispatches a resend job per outstanding error and redirects', function () {
    Bus::fake([ResendForwarding::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    // 2 outstanding errors + 1 resolved error (should be skipped)
    $e1 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:00:00']);
    $e2 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:01:00']);
    $e3 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:02:00']);
    ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'success','resend_of'=>$e3->id,'created_at'=>'2026-06-20 10:03:00']);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/resend", ['date' => '2026-06-20', 'integration' => (string) $integration->id])
        ->assertRedirect();

    Bus::assertDispatchedTimes(ResendForwarding::class, 2);
});

it('forbids resending for a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/resend", ['date' => '2026-06-20', 'integration' => '1'])
        ->assertNotFound();
});
