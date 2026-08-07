<?php

namespace App\Http\Controllers;

use App\Models\ModeProfile;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Production-side editor for mode profiles.
 *
 * Separate from ModeProfileController, which is the device-facing API the wizard calls to preview
 * and apply a profile. This one only maintains the catalogue itself.
 */
class ModeProfileAdminController extends Controller
{
    public function index(): Response
    {
        $profiles = ModeProfile::orderBy('label')->get()->map(function (ModeProfile $profile) {
            $definition = $profile->definition ?? [];
            $roles = $definition['roles'] ?? [];

            return [
                'id' => $profile->id,
                'mode' => $profile->mode,
                'label' => $profile->label,
                'enabled' => $profile->enabled,
                'description' => $definition['description'] ?? null,
                'disabledReason' => $definition['disabled_reason'] ?? null,
                'roleCount' => count($roles),
                // Counted here rather than in the page so the list does not have to walk the tree.
                'templateCount' => collect($roles)->sum(fn ($role) => count($role['templates'] ?? [])),
                'defaultMapping' => $definition['default_mapping'] ?? [],
                'roles' => $roles,
                'updatedAt' => $profile->updated_at?->format('Y-m-d H:i'),
            ];
        });

        return Inertia::render('production/mode-profiles', [
            'profiles' => $profiles,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validateProfile($request);

        ModeProfile::create($this->toRow($validated));

        return redirect()->route('production.mode-profiles.index')
            ->with('success', "Mode {$validated['mode']} berhasil dibuat.");
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $profile = ModeProfile::findOrFail($id);
        $validated = $this->validateProfile($request, $profile->id);

        $profile->update($this->toRow($validated, $profile));

        return redirect()->route('production.mode-profiles.index')
            ->with('success', "Mode {$validated['mode']} berhasil diperbarui.");
    }

    public function destroy(int $id): RedirectResponse
    {
        $profile = ModeProfile::findOrFail($id);
        $mode = $profile->mode;
        $profile->delete();

        return redirect()->route('production.mode-profiles.index')
            ->with('success', "Mode {$mode} berhasil dihapus.");
    }

    /**
     * The whole tree arrives in one request — the editor saves a mode at a time, matching how the
     * catalogue reads it. Nested rules are spelled out rather than accepting free-form JSON so a
     * malformed template cannot reach a device.
     */
    private function validateProfile(Request $request, ?int $ignoreId = null): array
    {
        return $request->validate([
            'mode' => [
                'required', 'string', 'max:32', 'regex:/^[A-Z][A-Z0-9_]*$/',
                Rule::unique('mode_profiles', 'mode')->ignore($ignoreId),
            ],
            'label' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:1000'],
            'enabled' => ['required', 'boolean'],
            'disabled_reason' => ['nullable', 'string', 'max:255'],
            'default_mapping' => ['present', 'array', 'max:64'],
            'default_mapping.*' => ['required', 'string', 'max:100'],

            'roles' => ['present', 'array', 'max:16'],
            'roles.*.role' => ['required', 'string', 'max:64', 'regex:/^[a-z][a-z0-9_]*$/'],
            'roles.*.label' => ['required', 'string', 'max:255'],
            'roles.*.required' => ['required', 'boolean'],

            'roles.*.templates' => ['present', 'array', 'max:16'],
            'roles.*.templates.*.id' => ['required', 'string', 'max:100', 'regex:/^[a-z0-9][a-z0-9-]*$/'],
            'roles.*.templates.*.name' => ['required', 'string', 'max:255'],
            'roles.*.templates.*.description' => ['nullable', 'string', 'max:1000'],
            'roles.*.templates.*.enabled' => ['required', 'boolean'],
            'roles.*.templates.*.disabled_reason' => ['nullable', 'string', 'max:255'],
            // RS485 only, and not as a placeholder: ModeProfilePreviewService rejects anything else
            // outright ("MVP mode profile hanya mendukung template RS485"), and
            // ModeProfileApplyService implements syncRs485Slave() and nothing more. Accepting a wider
            // set here would let an operator save a template that the wizard then refuses to apply.
            // Widen this only together with those two services.
            'roles.*.templates.*.connection_type' => ['required', Rule::in(['rs485'])],

            'roles.*.templates.*.device' => ['present', 'array'],
            'roles.*.templates.*.device.device_name' => ['nullable', 'string', 'max:255'],
            'roles.*.templates.*.device.function_code' => ['nullable', 'integer', 'min:1', 'max:4'],
            'roles.*.templates.*.device.register_address' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'roles.*.templates.*.device.baudrate' => ['nullable', 'integer', Rule::in([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200])],
            'roles.*.templates.*.device.serial_format' => ['nullable', 'string', 'max:8'],

            // The slave ID the operator fills in when applying the profile.
            'roles.*.templates.*.user_inputs' => ['present', 'array', 'max:8'],
            'roles.*.templates.*.user_inputs.*.key' => ['required', 'string', 'max:64'],
            'roles.*.templates.*.user_inputs.*.label' => ['required', 'string', 'max:255'],
            'roles.*.templates.*.user_inputs.*.type' => ['required', Rule::in(['number', 'text'])],
            'roles.*.templates.*.user_inputs.*.min' => ['nullable', 'integer'],
            'roles.*.templates.*.user_inputs.*.max' => ['nullable', 'integer'],
            'roles.*.templates.*.user_inputs.*.default' => ['nullable'],
            'roles.*.templates.*.user_inputs.*.required' => ['required', 'boolean'],

            'roles.*.templates.*.parameters' => ['present', 'array', 'max:16'],
            'roles.*.templates.*.parameters.*.name' => ['required', 'string', 'max:255'],
            'roles.*.templates.*.parameters.*.unit' => ['nullable', 'string', 'max:32'],
            'roles.*.templates.*.parameters.*.scale_factor' => ['required', 'numeric'],
            'roles.*.templates.*.parameters.*.register_address' => ['required', 'integer', 'min:0', 'max:65535'],
            // Despite the name, reg_count carries the Modbus data TYPE code, not a register count —
            // the firmware derives the span from the code. Valid codes are 1..27 (MB_TYPE_TABLE, see
            // docs/modbus_data_type_codes.md). This was capped at 8 while the field was mistaken for
            // a register count, which silently rejected every 64-bit and byte-swapped type.
            'roles.*.templates.*.parameters.*.reg_count' => ['required', 'integer', 'between:1,27'],
            'roles.*.templates.*.parameters.*.data_type_label' => ['nullable', 'string', 'max:64'],
            'roles.*.templates.*.parameters.*.fast_poll' => ['required', 'boolean'],
        ]);
    }

    /**
     * Split the validated payload into the indexed columns and the JSON definition.
     *
     * `mode`, `label` and `enabled` are written to both; ModeProfile::toProfileArray() lets the
     * columns win when it reassembles the profile, so the pair can never drift.
     *
     * Calibration is NOT editable here — it belongs to logger_modes and the calibration cards. It
     * still has to be carried across on update, or saving a profile from this page would silently
     * strip the calibration the seed shipped with.
     */
    private function toRow(array $validated, ?ModeProfile $existing = null): array
    {
        $previous = $existing?->definition ?? [];

        return [
            'mode' => $validated['mode'],
            'label' => $validated['label'],
            'enabled' => $validated['enabled'],
            'definition' => [
                'mode' => $validated['mode'],
                'label' => $validated['label'],
                'description' => $validated['description'] ?? null,
                'enabled' => $validated['enabled'],
                'disabled_reason' => $validated['disabled_reason'] ?? null,
                'roles' => $validated['roles'],
                'default_mapping' => $validated['default_mapping'],
                'automatic_calibration' => $previous['automatic_calibration'] ?? null,
                'calibration' => $previous['calibration'] ?? null,
            ],
        ];
    }
}
