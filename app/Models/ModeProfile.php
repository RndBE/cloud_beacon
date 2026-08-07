<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A mode profile: the sensors, slaves and parameters the Mode Profile Wizard writes to a logger
 * when an operator picks a mode.
 *
 * `mode`, `label` and `enabled` are columns so the Production list page can sort and filter without
 * unpacking JSON; the rest of the tree lives in `definition`. The columns are authoritative for
 * those three fields — toProfileArray() overlays them onto the definition so the two can never
 * disagree, whichever one an edit happened to touch.
 */
class ModeProfile extends Model
{
    protected $fillable = [
        'mode',
        'label',
        'enabled',
        'definition',
    ];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'definition' => 'array',
        ];
    }

    /**
     * The profile in the exact shape ModeProfileCatalog consumers expect.
     */
    public function toProfileArray(): array
    {
        return array_merge($this->definition ?? [], [
            'mode' => $this->mode,
            'label' => $this->label,
            'enabled' => $this->enabled,
        ]);
    }
}
