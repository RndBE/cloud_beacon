<?php

namespace App\Http\Controllers;

use App\Models\AssistantConversation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Per-user history of assistant chats. The browser owns the conversation and
 * saves it here after each turn; every query is scoped to the signed-in user.
 */
class AssistantConversationController extends Controller
{
    private const KEEP_PER_USER = 50;

    private const MAX_BYTES = 1_500_000;

    public function index(Request $request): JsonResponse
    {
        return response()->json(
            $request->user()->assistantConversations()
                ->latest('updated_at')->limit(30)
                ->get(['id', 'title', 'updated_at'])
        );
    }

    public function show(Request $request, int $conversation): JsonResponse
    {
        $found = $request->user()->assistantConversations()->findOrFail($conversation);

        return response()->json($found->only(['id', 'title', 'summary', 'ui', 'api', 'updated_at']));
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $conversation = $user->assistantConversations()->create($this->validated($request));

        // Oldest chats beyond the cap go, so the table stays bounded per user.
        $user->assistantConversations()->latest('updated_at')->offset(self::KEEP_PER_USER)->limit(1000)
            ->pluck('id')
            ->whenNotEmpty(fn ($ids) => AssistantConversation::whereIn('id', $ids)->delete());

        return response()->json(['id' => $conversation->id], 201);
    }

    public function update(Request $request, int $conversation): JsonResponse
    {
        $found = $request->user()->assistantConversations()->findOrFail($conversation);
        $found->update($this->validated($request));

        return response()->json(['id' => $found->id]);
    }

    public function destroy(Request $request, int $conversation): JsonResponse
    {
        $request->user()->assistantConversations()->findOrFail($conversation)->delete();

        return response()->json(['ok' => true]);
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:120',
            'summary' => 'nullable|string|max:20000',
            'ui' => 'required|array|max:400',
            'api' => 'required|array|max:200',
        ]);

        abort_if(strlen(json_encode([$data['ui'], $data['api']])) > self::MAX_BYTES, 422, 'Percakapan terlalu besar untuk disimpan.');

        return $data;
    }
}
