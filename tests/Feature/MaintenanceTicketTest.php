<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

function userWithMaintenancePermissions(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'test-'.str()->random(8),
        'display_name' => 'Test Role',
    ]);

    $permissionIds = collect($permissions)->map(function (string $name) {
        return Permission::firstOrCreate(
            ['name' => $name],
            ['display_name' => $name, 'group' => 'Maintenance']
        )->id;
    });

    $role->permissions()->sync($permissionIds);
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

function maintenanceTicketPayload(Logger $logger, array $overrides = []): array
{
    return array_replace_recursive([
        'logger_id' => $logger->id,
        'performed_at' => '2026-07-06',
        'issues' => ['Logger tidak mengirim data'],
        'repairs' => ['Reset modem dan cek koneksi power'],
        'priority' => 'medium',
    ], $overrides);
}

it('creates a maintenance ticket for a logger visible to the user', function () {
    $user = userWithMaintenancePermissions(['maintenance.view', 'maintenance.create']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'Logger Bendungan',
        'serial_number' => 'CB-001',
    ]);

    $this->actingAs($user)
        ->post('/maintenance', maintenanceTicketPayload($logger, [
            'issues' => ['Tidak mengirim data'],
            'repairs' => ['Cek modem dan koneksi MQTT'],
            'failure_type' => 'Komunikasi',
            'priority' => 'high',
        ]))
        ->assertRedirect();

    $this->assertDatabaseHas('maintenance_tickets', [
        'logger_id' => $logger->id,
        'reported_by' => $user->id,
        'issue_title' => 'Tidak mengirim data',
        'failure_type' => 'Komunikasi',
        'priority' => 'high',
        'status' => 'open',
    ]);
});

it('creates a maintenance ticket with execution details and documentation uploads', function () {
    Storage::fake('public');

    $user = userWithMaintenancePermissions(['maintenance.view', 'maintenance.create']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'Logger Intake',
        'serial_number' => 'CB-ATT-001',
    ]);

    $this->actingAs($user)
        ->post('/maintenance', [
            'logger_id' => $logger->id,
            'performed_at' => '2026-07-06',
            'issues' => [
                'Logger tidak mengirim data sejak pagi',
                'Panel surya kotor dan tegangan drop',
            ],
            'repairs' => [
                'Membersihkan panel surya',
                'Reset modem dan cek konektor power',
            ],
            'report' => UploadedFile::fake()->create('laporan-maintenance.pdf', 128, 'application/pdf'),
            'photos' => [
                UploadedFile::fake()->image('sebelum.jpg', 800, 600),
                UploadedFile::fake()->image('sesudah.png', 800, 600),
            ],
            'priority' => 'high',
        ])
        ->assertRedirect();

    $ticket = DB::table('maintenance_tickets')->where('logger_id', $logger->id)->first();

    expect($ticket)->not->toBeNull()
        ->and($ticket->performed_at)->toStartWith('2026-07-06')
        ->and($ticket->issue_title)->toBe('Logger tidak mengirim data sejak pagi')
        ->and(json_decode($ticket->issues, true))->toBe([
            'Logger tidak mengirim data sejak pagi',
            'Panel surya kotor dan tegangan drop',
        ])
        ->and(json_decode($ticket->repairs, true))->toBe([
            'Membersihkan panel surya',
            'Reset modem dan cek konektor power',
        ]);

    expect($ticket->report_path)->toStartWith('maintenance/reports/');

    $photos = json_decode($ticket->documentation_photos, true);
    expect($photos)->toHaveCount(2)
        ->and($photos[0])->toStartWith('maintenance/photos/')
        ->and($photos[1])->toStartWith('maintenance/photos/');

    Storage::disk('public')->assertExists($ticket->report_path);
    Storage::disk('public')->assertExists($photos[0]);
    Storage::disk('public')->assertExists($photos[1]);
});

it('forbids creating a maintenance ticket for another users logger', function () {
    $owner = User::factory()->create();
    $user = userWithMaintenancePermissions(['maintenance.view', 'maintenance.create']);
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($user)
        ->post('/maintenance', maintenanceTicketPayload($logger, [
            'issues' => ['Rusak'],
            'repairs' => ['Cek power logger'],
        ]))
        ->assertNotFound();

    $this->assertDatabaseMissing('maintenance_tickets', [
        'logger_id' => $logger->id,
        'issue_title' => 'Rusak',
    ]);
});

it('updates repair progress and timestamps status changes', function () {
    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
        'maintenance.close',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', maintenanceTicketPayload($logger, [
        'issues' => ['Baterai drop'],
        'repairs' => ['Ganti baterai'],
        'priority' => 'critical',
    ]));

    $ticketId = DB::table('maintenance_tickets')->value('id');

    $this->actingAs($user)
        ->put("/maintenance/{$ticketId}", [
            'assigned_to' => $user->id,
            'status' => 'resolved',
            'priority' => 'critical',
            'repair_action' => 'Ganti baterai dan cek konektor panel surya.',
            'parts_used' => 'Baterai 12V 7Ah',
            'technician_notes' => 'Unit sudah stabil setelah penggantian.',
        ])
        ->assertRedirect();

    $ticket = DB::table('maintenance_tickets')->where('id', $ticketId)->first();

    expect($ticket->assigned_to)->toBe($user->id)
        ->and($ticket->status)->toBe('resolved')
        ->and($ticket->repair_action)->toBe('Ganti baterai dan cek konektor panel surya.')
        ->and($ticket->parts_used)->toBe('Baterai 12V 7Ah')
        ->and($ticket->started_at)->not->toBeNull()
        ->and($ticket->resolved_at)->not->toBeNull();
});

it('appends photos and replaces the report when updating a ticket', function () {
    Storage::fake('public');

    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', [
        'logger_id' => $logger->id,
        'performed_at' => '2026-07-06',
        'issues' => ['Logger mati'],
        'repairs' => ['Cek power'],
        'report' => UploadedFile::fake()->create('awal.pdf', 64, 'application/pdf'),
        'photos' => [UploadedFile::fake()->image('sebelum.jpg', 800, 600)],
        'priority' => 'high',
    ]);

    $ticketId = DB::table('maintenance_tickets')->value('id');
    $original = DB::table('maintenance_tickets')->where('id', $ticketId)->first();
    $originalReport = $original->report_path;

    $this->actingAs($user)
        ->put("/maintenance/{$ticketId}", [
            'assigned_to' => $user->id,
            'status' => 'in_progress',
            'priority' => 'high',
            'repair_action' => 'Ganti adaptor.',
            'parts_used' => 'Adaptor 12V',
            'technician_notes' => 'Tambah dokumentasi sesudah.',
            'report' => UploadedFile::fake()->create('final.pdf', 64, 'application/pdf'),
            'photos' => [UploadedFile::fake()->image('sesudah.png', 800, 600)],
        ])
        ->assertRedirect();

    $ticket = DB::table('maintenance_tickets')->where('id', $ticketId)->first();
    $photos = json_decode($ticket->documentation_photos, true);

    expect($photos)->toHaveCount(2)
        ->and($ticket->report_path)->not->toBe($originalReport);

    Storage::disk('public')->assertMissing($originalReport);
    Storage::disk('public')->assertExists($ticket->report_path);
    foreach ($photos as $photo) {
        Storage::disk('public')->assertExists($photo);
    }
});

it('deletes a ticket and removes its attachments', function () {
    Storage::fake('public');

    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.delete',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', [
        'logger_id' => $logger->id,
        'performed_at' => '2026-07-06',
        'issues' => ['Logger mati'],
        'repairs' => ['Cek power'],
        'report' => UploadedFile::fake()->create('laporan.pdf', 64, 'application/pdf'),
        'photos' => [UploadedFile::fake()->image('foto.jpg', 800, 600)],
        'priority' => 'medium',
    ]);

    $ticket = DB::table('maintenance_tickets')->first();
    $photos = json_decode($ticket->documentation_photos, true);

    $this->actingAs($user)
        ->delete("/maintenance/{$ticket->id}")
        ->assertRedirect(route('maintenance.index'));

    $this->assertDatabaseMissing('maintenance_tickets', ['id' => $ticket->id]);
    Storage::disk('public')->assertMissing($ticket->report_path);
    Storage::disk('public')->assertMissing($photos[0]);
});

it('forbids deleting a ticket without the delete permission', function () {
    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', maintenanceTicketPayload($logger, [
        'issues' => ['Sensor error'],
        'repairs' => ['Cek wiring'],
    ]));

    $ticketId = DB::table('maintenance_tickets')->value('id');

    $this->actingAs($user)
        ->delete("/maintenance/{$ticketId}")
        ->assertForbidden();

    $this->assertDatabaseHas('maintenance_tickets', ['id' => $ticketId]);
});

it('rejects closing a ticket without technician notes', function () {
    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
        'maintenance.close',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', maintenanceTicketPayload($logger, [
        'issues' => ['Modem hang'],
        'repairs' => ['Restart modem'],
    ]));

    $ticketId = DB::table('maintenance_tickets')->value('id');

    $this->actingAs($user)
        ->put("/maintenance/{$ticketId}", [
            'assigned_to' => $user->id,
            'status' => 'closed',
            'priority' => 'medium',
            'repair_action' => 'Restart modem.',
            'parts_used' => '',
            'technician_notes' => '',
        ])
        ->assertSessionHasErrors('technician_notes');

    $this->assertDatabaseHas('maintenance_tickets', [
        'id' => $ticketId,
        'status' => 'open',
    ]);
});

it('clears completion timestamps when a ticket is moved back to in progress', function () {
    $user = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
        'maintenance.close',
    ]);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)->post('/maintenance', maintenanceTicketPayload($logger, [
        'issues' => ['Koneksi putus-putus'],
        'repairs' => ['Reset modem'],
        'priority' => 'high',
    ]));

    $ticketId = DB::table('maintenance_tickets')->value('id');

    $this->actingAs($user)->put("/maintenance/{$ticketId}", [
        'assigned_to' => $user->id,
        'status' => 'resolved',
        'priority' => 'high',
        'repair_action' => 'Reset modem dan update konfigurasi APN.',
        'parts_used' => '',
        'technician_notes' => 'Awalnya normal setelah reset.',
    ]);

    $resolvedTicket = DB::table('maintenance_tickets')->where('id', $ticketId)->first();
    expect($resolvedTicket->resolved_at)->not->toBeNull();

    $this->actingAs($user)->put("/maintenance/{$ticketId}", [
        'assigned_to' => $user->id,
        'status' => 'in_progress',
        'priority' => 'high',
        'repair_action' => 'Masalah muncul lagi, lanjut pengecekan modem.',
        'parts_used' => '',
        'technician_notes' => 'Status diturunkan karena belum stabil.',
    ]);

    $ticket = DB::table('maintenance_tickets')->where('id', $ticketId)->first();

    expect($ticket->status)->toBe('in_progress')
        ->and($ticket->started_at)->not->toBeNull()
        ->and($ticket->resolved_at)->toBeNull()
        ->and($ticket->closed_at)->toBeNull();
});

it('shares maintenance permissions only for users that have them', function () {
    $viewer = userWithMaintenancePermissions(['dashboard.view']);

    $this->actingAs($viewer)
        ->get('/dashboard')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->has('auth.permissions')
            ->where('auth.permissions.0', 'dashboard.view')
        );

    $maintainer = userWithMaintenancePermissions(['dashboard.view', 'maintenance.view']);

    $this->actingAs($maintainer)
        ->get('/dashboard')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('auth.permissions.0', 'dashboard.view')
            ->where('auth.permissions.1', 'maintenance.view')
        );
});

it('lists only users with maintenance update permission as technicians', function () {
    $operator = userWithMaintenancePermissions(['maintenance.view', 'maintenance.create']);
    $operator->update(['name' => 'Operator User']);
    Logger::factory()->create(['user_id' => $operator->id]);

    $technician = userWithMaintenancePermissions(['maintenance.update']);
    $technician->update(['name' => 'Able Technician']);

    $viewer = userWithMaintenancePermissions(['dashboard.view']);
    $viewer->update(['name' => 'Viewer User']);

    $this->actingAs($operator)
        ->get('/maintenance')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->has('technicians', 1)
            ->where('technicians.0.id', $technician->id)
            ->where('technicians.0.name', 'Able Technician')
        );
});

it('rejects assigning a new maintenance ticket to a user without update permission', function () {
    $operator = userWithMaintenancePermissions(['maintenance.view', 'maintenance.create']);
    $logger = Logger::factory()->create(['user_id' => $operator->id]);
    $viewer = userWithMaintenancePermissions(['dashboard.view']);

    $this->actingAs($operator)
        ->post('/maintenance', maintenanceTicketPayload($logger, [
            'assigned_to' => $viewer->id,
            'issues' => ['Tidak bisa konek'],
            'repairs' => ['Cek konfigurasi broker'],
            'priority' => 'medium',
        ]))
        ->assertSessionHasErrors('assigned_to');

    $this->assertDatabaseMissing('maintenance_tickets', [
        'logger_id' => $logger->id,
        'issue_title' => 'Tidak bisa konek',
    ]);
});

it('rejects reassigning a maintenance ticket to a user without update permission', function () {
    $operator = userWithMaintenancePermissions([
        'maintenance.view',
        'maintenance.create',
        'maintenance.update',
    ]);
    $logger = Logger::factory()->create(['user_id' => $operator->id]);
    $viewer = userWithMaintenancePermissions(['dashboard.view']);

    $this->actingAs($operator)->post('/maintenance', maintenanceTicketPayload($logger, [
        'issues' => ['Sensor tidak terbaca'],
        'repairs' => ['Cek wiring sensor'],
        'priority' => 'high',
    ]));

    $ticketId = DB::table('maintenance_tickets')->value('id');

    $this->actingAs($operator)
        ->put("/maintenance/{$ticketId}", [
            'assigned_to' => $viewer->id,
            'status' => 'in_progress',
            'priority' => 'high',
            'repair_action' => 'Cek wiring sensor.',
            'parts_used' => '',
            'technician_notes' => '',
        ])
        ->assertSessionHasErrors('assigned_to');

    $this->assertDatabaseHas('maintenance_tickets', [
        'id' => $ticketId,
        'assigned_to' => null,
    ]);
});
