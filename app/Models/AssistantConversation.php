<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One chat with the AI assistant, kept per user so it can be continued later.
 * `ui` is what the panel renders (tool cards included), `api` the (compacted)
 * message list sent to the model, `summary` the memory of what was compacted away.
 */
class AssistantConversation extends Model
{
    protected $fillable = ['user_id', 'title', 'summary', 'ui', 'api'];

    protected function casts(): array
    {
        return ['ui' => 'array', 'api' => 'array'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
