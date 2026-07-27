<?php

namespace App\Services\ModeProfiles;

use App\Models\Logger;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class ModeProfilePreviewService
{
    public function __construct(
        private readonly ModeProfileCatalog $catalog,
    ) {}

    public function preview(Logger $logger, array $input): array
    {
        $mode = strtoupper((string) ($input['mode'] ?? ''));
        $profile = $this->catalog->find($mode);

        if (! $profile) {
            throw ValidationException::withMessages([
                'mode' => 'Mode profile tidak ditemukan.',
            ]);
        }

        if (! ($profile['enabled'] ?? false)) {
            throw ValidationException::withMessages([
                'mode' => $profile['disabled_reason'] ?? 'Mode profile belum tersedia.',
            ]);
        }

        if (! $logger->device_identifier) {
            throw ValidationException::withMessages([
                'id_logger' => 'Logger belum memiliki device identifier.',
            ]);
        }

        $selections = collect($input['selections'] ?? []);
        $resolvedSensors = [];
        $warnings = [];

        foreach ($profile['roles'] ?? [] as $roleIndex => $role) {
            $selection = $selections->first(
                fn (mixed $candidate) => is_array($candidate)
                    && ($candidate['role'] ?? null) === ($role['role'] ?? null),
            );

            if (! is_array($selection)) {
                if ($role['required'] ?? false) {
                    throw ValidationException::withMessages([
                        "selections.{$roleIndex}" => "Pilihan {$role['label']} wajib diisi.",
                    ]);
                }

                continue;
            }

            $resolved = $this->resolveSelection($profile, $role, $selection, $roleIndex);
            $resolvedSensors[] = $resolved;

            $conflicts = $logger->sensors()
                ->where('connection_type', 'rs485')
                ->where('modbus_slave_id', $resolved['slave_id'])
                ->orderBy('id')
                ->get();

            if ($conflicts->isNotEmpty()) {
                $warnings[] = $this->overwriteWarning($resolved, $conflicts);
            }
        }

        $duplicateSlaveIds = collect($resolvedSensors)
            ->groupBy('slave_id')
            ->filter(fn (Collection $items) => $items->count() > 1);

        if ($duplicateSlaveIds->isNotEmpty()) {
            $messages = $duplicateSlaveIds
                ->map(fn (Collection $items, int|string $slaveId) => 'Slave ID '.$slaveId.' dipakai oleh '.$items->pluck('role_label')->implode(', ').'.')
                ->values()
                ->all();

            throw ValidationException::withMessages([
                'selections' => 'Slave ID setiap sensor RS485 harus unik. '.implode(' ', $messages),
            ]);
        }

        return [
            'success' => true,
            'mode' => $profile['mode'],
            'summary' => $this->summary($profile, $resolvedSensors),
            'warnings' => $warnings,
            'changes' => [
                'mode' => [
                    'from' => $logger->logger_mode,
                    'to' => $profile['mode'],
                ],
                'sensors' => $resolvedSensors,
                'mapping' => $profile['default_mapping'] ?? [],
                'calibration' => $profile['calibration'] ?? null,
            ],
            'requires_confirmation' => $warnings !== [],
        ];
    }

    private function resolveSelection(array $profile, array $role, array $selection, int $selectionIndex): array
    {
        $roleSlug = (string) ($role['role'] ?? '');
        $templateId = (string) ($selection['template_id'] ?? '');
        $template = $this->catalog->template($profile['mode'], $roleSlug, $templateId);

        if (! $template) {
            throw ValidationException::withMessages([
                "selections.{$selectionIndex}.template_id" => 'Template sensor tidak ditemukan.',
            ]);
        }

        if (! ($template['enabled'] ?? false)) {
            throw ValidationException::withMessages([
                "selections.{$selectionIndex}.template_id" => $template['disabled_reason'] ?? 'Template sensor belum tersedia.',
            ]);
        }

        if (($template['connection_type'] ?? null) !== 'rs485') {
            throw ValidationException::withMessages([
                "selections.{$selectionIndex}.template_id" => 'MVP mode profile hanya mendukung template RS485.',
            ]);
        }

        $slaveId = filter_var(
            $selection['inputs']['slave_id'] ?? null,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1, 'max_range' => 10]],
        );

        if ($slaveId === false) {
            throw ValidationException::withMessages([
                "selections.{$selectionIndex}.inputs.slave_id" => 'Slave ID harus berupa angka 1 sampai 10.',
            ]);
        }

        return [
            'action' => 'replace_rs485_slave',
            'role' => $roleSlug,
            'role_label' => $role['label'],
            'slave_id' => $slaveId,
            'template_id' => $template['id'],
            'template' => $template['name'],
            'connection_type' => $template['connection_type'],
            'device' => [
                ...$template['device'],
                'modbus_slave_id' => $slaveId,
            ],
            'parameters' => $template['parameters'],
        ];
    }

    private function overwriteWarning(array $resolved, Collection $conflicts): array
    {
        $sensorNames = $conflicts->pluck('name')->unique()->implode(', ');

        return [
            'type' => 'overwrite_sensor',
            'severity' => 'warning',
            'role' => $resolved['role'],
            'slave_id' => $resolved['slave_id'],
            'message' => "Slave ID {$resolved['slave_id']} sudah digunakan oleh {$sensorNames}. Jika dilanjutkan, konfigurasi sensor tersebut akan diganti.",
            'existing_sensors' => $conflicts->map(fn ($sensor) => [
                'id' => $sensor->id,
                'name' => $sensor->name,
                'device_name' => $sensor->device_name,
                'connection_type' => $sensor->connection_type,
                'modbus_slave_id' => $sensor->modbus_slave_id,
            ])->values()->all(),
        ];
    }

    private function summary(array $profile, array $resolvedSensors): string
    {
        $sensorSummary = collect($resolvedSensors)
            ->map(fn (array $sensor) => "{$sensor['template']} pada Slave ID {$sensor['slave_id']}")
            ->implode(', ');

        return "{$profile['mode']} akan diset menggunakan {$sensorSummary}.";
    }
}
