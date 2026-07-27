<?php

namespace App\Services\ModeProfiles;

interface ModeProfileCatalog
{
    public function find(string $mode): ?array;

    public function template(string $mode, string $role, string $templateId): ?array;
}
