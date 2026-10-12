<?php

namespace App\Services\ModeProfiles;

use App\Models\Logger;
use App\Support\BoardModel;
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

        if ($resolvedSensors === [] && ($profile['roles'] ?? []) !== []) {
            throw ValidationException::withMessages([
                'selections' => 'Pilih minimal satu sensor.',
            ]);
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

        $mapping = $this->mapping($profile, $resolvedSensors);
        $this->assertFitsBoard($logger, $resolvedSensors, $mapping);

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
                'mapping' => $mapping,
                'calibration' => $profile['calibration'] ?? null,
                'automatic_calibration' => $this->automaticCalibration(
                    $profile,
                    $resolvedSensors,
                    $input['automatic_calibration'] ?? [],
                ),
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

    /**
     * Refuse a setup the board cannot hold, before anything is sent: a BL110 has 16 telemetry
     * slots and only s1..s9 for MAP_DATA, so a full AWR (10 mapping slots) does not fit there.
     *
     * Sensor slots count what the logger ends up with — the sensors already on it, minus the ones
     * on a Slave ID this setup replaces, plus every parameter being installed. Virtual profile
     * outputs (ARR.*, AWLR_TD.*, …) are computed by the firmware and take no sensor slot.
     */
    private function assertFitsBoard(Logger $logger, array $resolvedSensors, array $mapping): void
    {
        $variant = BoardModel::variant(
            $logger->model,
            $logger->serial_number,
            $logger->connection_type,
            $logger->deviceModel?->channel_count,
        );
        $limits = BoardModel::slotLimits($variant);

        if ($limits === null) {
            return;
        }

        $replacedSlaves = collect($resolvedSensors)->pluck('slave_id')->all();
        $kept = $logger->sensors()
            ->get(['name', 'connection_type', 'modbus_slave_id'])
            ->reject(fn ($sensor) => $sensor->connection_type === 'rs485'
                && in_array((int) $sensor->modbus_slave_id, $replacedSlaves, true))
            ->reject(fn ($sensor) => preg_match('/^(AWLR_TD|AWLR_US|ARR|GNSS|APMS|AWR)\./i', (string) $sensor->name))
            ->count();
        $sensorSlots = $kept + collect($resolvedSensors)->sum(fn (array $sensor) => count($sensor['parameters']));

        $problems = [];
        if (count($mapping) > $limits['mapping']) {
            $problems[] = 'butuh '.count($mapping)." slot mapping, maksimal {$limits['mapping']}";
        }
        if ($sensorSlots > $limits['sensor']) {
            $problems[] = "butuh {$sensorSlots} slot sensor (termasuk {$kept} sensor yang sudah ada), maksimal {$limits['sensor']}";
        }

        if ($problems !== []) {
            throw ValidationException::withMessages([
                'selections' => "Logger {$variant} tidak mendukung konfigurasi ini: ".implode('; ', $problems).'. Hapus sensor yang tidak dipakai.',
            ]);
        }
    }

    /**
     * MAP_DATA slots, built from the sensors actually being installed.
     *
     * Each role carries the slots its sensor feeds (`roles.*.mapping`), taken in role order for the
     * kept roles only — a removed sensor leaves no dangling slot and no gap in s1..sN. The profile's
     * `default_mapping` holds the slots no single sensor owns (e.g. Status_Modbus) and goes last.
     */
    private function mapping(array $profile, array $resolvedSensors): array
    {
        $kept = collect($resolvedSensors)->pluck('role')->all();

        return collect($profile['roles'] ?? [])
            ->filter(fn (array $role) => in_array($role['role'] ?? null, $kept, true))
            ->flatMap(fn (array $role) => $role['mapping'] ?? [])
            ->concat($profile['default_mapping'] ?? [])
            ->filter(fn (mixed $slot) => is_string($slot) && $slot !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * The mode command the apply step sends after the sensors (e.g. ARR's source + sensor type).
     *
     * A profile can tie it to one role via `automatic_calibration_role` — AWR's rain gauge source
     * only makes sense when a rain gauge is actually being installed, so it is dropped when that
     * role was removed. The wizard may override the catalogue defaults, but only for keys the
     * profile already defines, so a request cannot smuggle extra fields into the device command.
     */
    private function automaticCalibration(array $profile, array $resolvedSensors, mixed $overrides): ?array
    {
        $defaults = $profile['automatic_calibration'] ?? null;

        if (! is_array($defaults) || $defaults === []) {
            return null;
        }

        $role = $profile['automatic_calibration_role'] ?? null;
        if ($role !== null && ! collect($resolvedSensors)->contains('role', $role)) {
            return null;
        }

        if (! is_array($overrides)) {
            return $defaults;
        }

        foreach ($defaults as $key => $default) {
            if (! array_key_exists($key, $overrides)) {
                continue;
            }

            $value = $overrides[$key];
            if (! is_string($value) || trim($value) === '' || mb_strlen($value) > 64) {
                throw ValidationException::withMessages([
                    "automatic_calibration.{$key}" => 'Nilai sumber sensor tidak valid.',
                ]);
            }

            $defaults[$key] = trim($value);
        }

        return $defaults;
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
