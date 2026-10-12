<?php

use App\Models\AssistantConversation;
use App\Models\User;

function conversationBody(array $overrides = []): array
{
    return $overrides + [
        'title' => 'Cek logger offline',
        'summary' => null,
        'ui' => [['id' => 1, 'kind' => 'user', 'text' => 'halo']],
        'api' => [['role' => 'user', 'content' => 'halo']],
    ];
}

it('saves, lists, loads, updates and deletes the signed-in user\'s chats', function () {
    $user = User::factory()->create();

    $id = test()->actingAs($user)->postJson('/assistant/conversations', conversationBody())
        ->assertCreated()->json('id');

    test()->actingAs($user)->getJson('/assistant/conversations')
        ->assertOk()->assertJsonCount(1)->assertJsonPath('0.title', 'Cek logger offline');

    test()->actingAs($user)->getJson("/assistant/conversations/{$id}")
        ->assertOk()
        ->assertJsonPath('api.0.content', 'halo')
        ->assertJsonPath('ui.0.kind', 'user');

    test()->actingAs($user)->putJson("/assistant/conversations/{$id}", conversationBody([
        'summary' => 'Sudah membahas logger A.',
        'api' => [['role' => 'user', 'content' => 'halo'], ['role' => 'assistant', 'content' => 'hai']],
    ]))->assertOk();
    expect(AssistantConversation::find($id))
        ->summary->toBe('Sudah membahas logger A.')
        ->api->toHaveCount(2);

    test()->actingAs($user)->deleteJson("/assistant/conversations/{$id}")->assertOk();
    expect(AssistantConversation::count())->toBe(0);
});

it('never shows or changes another user\'s chat', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $id = AssistantConversation::create(['user_id' => $owner->id] + conversationBody())->id;

    test()->actingAs($other)->getJson('/assistant/conversations')->assertOk()->assertJsonCount(0);
    test()->actingAs($other)->getJson("/assistant/conversations/{$id}")->assertNotFound();
    test()->actingAs($other)->putJson("/assistant/conversations/{$id}", conversationBody(['title' => 'diubah']))->assertNotFound();
    test()->actingAs($other)->deleteJson("/assistant/conversations/{$id}")->assertNotFound();

    expect(AssistantConversation::find($id)->title)->toBe('Cek logger offline');
});

it('requires a signed-in user and a valid body', function () {
    test()->postJson('/assistant/conversations', conversationBody())->assertUnauthorized();

    test()->actingAs(User::factory()->create())
        ->postJson('/assistant/conversations', ['title' => 'x'])
        ->assertStatus(422)->assertJsonValidationErrors(['ui', 'api']);
});

it('refuses a chat that is too large to store', function () {
    test()->actingAs(User::factory()->create())
        ->postJson('/assistant/conversations', conversationBody([
            'api' => [['role' => 'tool', 'content' => str_repeat('x', 29000)]] + array_fill(1, 60, ['role' => 'tool', 'content' => str_repeat('y', 29000)]),
        ]))
        ->assertStatus(422);
});

it('keeps only the latest 50 chats per user', function () {
    $user = User::factory()->create();
    $other = User::factory()->create();
    foreach (range(1, 50) as $i) {
        AssistantConversation::create(['user_id' => $user->id, 'title' => "lama {$i}", 'updated_at' => now()->subDays(60 - $i)] + conversationBody());
    }
    AssistantConversation::create(['user_id' => $other->id] + conversationBody());

    test()->actingAs($user)->postJson('/assistant/conversations', conversationBody(['title' => 'baru']))->assertCreated();

    expect($user->assistantConversations()->count())->toBe(50)
        ->and($user->assistantConversations()->where('title', 'lama 1')->exists())->toBeFalse()
        ->and($user->assistantConversations()->where('title', 'baru')->exists())->toBeTrue()
        ->and($other->assistantConversations()->count())->toBe(1);
});
