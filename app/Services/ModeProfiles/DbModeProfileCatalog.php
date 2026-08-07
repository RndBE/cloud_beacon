<?php

namespace App\Services\ModeProfiles;

use App\Models\ModeProfile;

/**
 * The runtime catalogue, backed by the mode_profiles table so Production can edit sensors, slaves
 * and parameters without a deploy.
 *
 * Reads are memoised per request: ModeProfilePreviewService calls find() once and then template()
 * for every selection, which would otherwise be one query per sensor.
 */
class DbModeProfileCatalog implements ModeProfileCatalog
{
    /** @var array<string, array|null> */
    private array $cache = [];

    public function find(string $mode): ?array
    {
        $key = strtoupper($mode);

        if (! array_key_exists($key, $this->cache)) {
            $this->cache[$key] = ModeProfile::where('mode', $key)->first()?->toProfileArray();
        }

        return $this->cache[$key];
    }

    public function template(string $mode, string $role, string $templateId): ?array
    {
        $profile = $this->find($mode);

        if (! $profile) {
            return null;
        }

        foreach ($profile['roles'] ?? [] as $profileRole) {
            if (($profileRole['role'] ?? null) !== $role) {
                continue;
            }

            foreach ($profileRole['templates'] ?? [] as $template) {
                if (($template['id'] ?? null) === $templateId) {
                    return $template;
                }
            }
        }

        return null;
    }
}
