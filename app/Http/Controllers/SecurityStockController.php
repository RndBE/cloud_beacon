<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityPairingException;
use App\Models\SecurityDevice;
use App\Services\IdHasher;
use App\Services\SecurityPairingService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Unit modul Security System dari sisi produksi: dicatat seperti logger di
 * halaman Production (tampilan Modul) - nomor seri, model, QC dan seterusnya -
 * lalu dipasang ke logger dari tab Module di halaman logger.
 *
 * Kolom produksinya (serial_number, model, qc_status, ...) murni data website,
 * jadi diisi langsung di sini dan bukan lewat kontrak SecurityPairingService.
 * Hanya pembuatan unitnya yang lewat register(), yang menjaga aturan ID firmware.
 */
class SecurityStockController extends Controller
{
    private const QC_STATUSES = ['pending', 'passed', 'failed'];

    // Columns the production form and CSV import fill, besides the ID.
    private const PRODUCTION_FIELDS = ['serial_number', 'model', 'hardware_version', 'production_date', 'tested_by', 'qc_status', 'notes'];

    public function index(): Response
    {
        return Inertia::render('production/security-devices', ['devices' => self::rows()]);
    }

    /**
     * Every unit with its production record, online state and installed logger;
     * listed on the Production page's Modul view.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public static function rows(): Collection
    {
        return SecurityDevice::with('logger:id,name,serial_number')
            ->orderByDesc('created_at')
            ->orderBy('device_id')
            ->get()
            ->map(fn (SecurityDevice $device) => [
                'deviceId' => $device->device_id,
                'serialNumber' => $device->serial_number ?? $device->device_id,
                'name' => $device->name,
                'model' => $device->model,
                'hardwareVersion' => $device->hardware_version,
                'productionDate' => $device->production_date
                    ? substr((string) $device->production_date, 0, 10)
                    : null,
                'testedBy' => $device->tested_by,
                'qcStatus' => $device->qc_status ?? 'pending',
                'notes' => $device->notes,
                'online' => $device->isOnline(),
                'lastSeenAt' => $device->last_seen_at?->toIso8601String(),
                'logger' => $device->logger ? [
                    'id' => IdHasher::encode($device->logger->id),
                    'name' => $device->logger->name,
                    'serialNumber' => $device->logger->serial_number,
                ] : null,
            ]);
    }

    public function store(Request $request, SecurityPairingService $pairing): RedirectResponse
    {
        $data = $request->validate([
            'serial_number' => ['nullable', 'required_without:device_id', 'string', 'max:255'],
            // The MQTT ID; defaults to the serial number, which it normally equals.
            'device_id' => ['nullable', 'string', 'max:31'],
            'name' => ['nullable', 'string', 'max:255'],
            'model' => ['nullable', 'string', 'max:255'],
            'hardware_version' => ['nullable', 'string', 'max:50'],
            'production_date' => ['nullable', 'date'],
            'tested_by' => ['nullable', 'string', 'max:255'],
            'qc_status' => ['nullable', Rule::in(self::QC_STATUSES)],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        $deviceId = trim($data['device_id'] ?? '') ?: trim($data['serial_number']);
        $serial = trim($data['serial_number'] ?? '') ?: $deviceId;

        $taken = SecurityDevice::where('serial_number', $serial)->where('device_id', '!=', $deviceId)->exists();
        if ($taken) {
            return back()->withErrors(['serial_number' => "Serial number {$serial} sudah dipakai modul lain."])->withInput();
        }

        try {
            $device = $pairing->register($deviceId, $data['name'] ?? null);
        } catch (SecurityPairingException $e) {
            return back()->withErrors([isset($data['device_id']) ? 'device_id' : 'serial_number' => $e->getMessage()])->withInput();
        }
        $created = $device->wasRecentlyCreated;

        $device->forceFill(array_filter(
            ['serial_number' => $serial] + array_intersect_key($data, array_flip(self::PRODUCTION_FIELDS)),
            fn ($value) => $value !== null && $value !== '',
        ))->save();

        // register() updates a unit that already exists instead of failing.
        return back()->with('success', $created
            ? "Modul {$serial} didaftarkan sebagai stok."
            : "Modul {$serial} sudah terdaftar; datanya diperbarui.");
    }

    /**
     * Correct a production record, like a logger's: only while QC is still pending,
     * after which the record is final. The ID (MQTT address) never changes here.
     */
    public function update(Request $request, string $deviceId): RedirectResponse
    {
        $device = SecurityDevice::where('device_id', $deviceId)->firstOrFail();

        if (($device->qc_status ?? 'pending') !== 'pending') {
            return back()->with('error', "Hanya modul dengan QC pending yang bisa diedit. {$device->serial_number} sudah {$device->qc_status}.");
        }

        $data = $request->validate([
            'serial_number' => ['required', 'string', 'max:255', Rule::unique('security_devices')->ignore($device->id)],
            'model' => ['nullable', 'string', 'max:255'],
            'hardware_version' => ['nullable', 'string', 'max:50'],
            'tested_by' => ['nullable', 'string', 'max:255'],
            'qc_status' => ['required', Rule::in(self::QC_STATUSES)],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $device->forceFill($data)->save();

        return back()->with('success', "Modul {$device->serial_number} diperbarui.");
    }

    // Same column list as the logger import (batch_number is ignored for modules).
    public function import(Request $request, SecurityPairingService $pairing): RedirectResponse
    {
        $request->validate(['csv_file' => 'required|file|mimes:csv,txt|max:2048']);

        $rows = array_map('str_getcsv', file($request->file('csv_file')->getRealPath()));
        $header = array_map('trim', array_shift($rows) ?? []);

        $imported = 0;
        $skipped = 0;
        foreach ($rows as $row) {
            if (count($row) < count($header)) {
                continue;
            }
            $data = array_combine($header, array_map('trim', $row));
            $serial = $data['serial_number'] ?? '';
            $deviceId = ($data['device_id'] ?? '') ?: $serial;
            $qc = in_array($data['qc_status'] ?? '', self::QC_STATUSES, true) ? $data['qc_status'] : 'pending';

            if ($serial === '' || SecurityDevice::where('serial_number', $serial)->orWhere('device_id', $deviceId)->exists()) {
                $skipped++;

                continue;
            }
            try {
                $device = $pairing->register($deviceId);
            } catch (SecurityPairingException) {
                $skipped++;

                continue;
            }
            $device->forceFill(array_filter([
                'serial_number' => $serial,
                'model' => $data['model'] ?? null,
                'hardware_version' => $data['hardware_version'] ?? null,
                'production_date' => ($data['production_date'] ?? '') ?: null,
                'tested_by' => $data['tested_by'] ?? null,
                'qc_status' => $qc,
                'notes' => $data['notes'] ?? null,
            ], fn ($value) => $value !== null && $value !== ''))->save();
            $imported++;
        }

        return back()->with('success', "Imported {$imported} modules. Skipped {$skipped} (duplicates/invalid).");
    }

    // Deleting a unit also deletes its events, photos and cards, so only stock units
    // (not installed on a logger) can go.
    public function destroy(string $deviceId): RedirectResponse
    {
        $device = SecurityDevice::where('device_id', $deviceId)->firstOrFail();

        if ($device->logger_id !== null) {
            return back()->with('error', "Modul {$device->serial_number} masih terpasang di logger. Lepas dulu dari tab Module logger tersebut.");
        }

        $device->delete();

        return back()->with('success', "Modul {$device->serial_number} dihapus.");
    }

    // QC is the production department's check, recorded here like a logger's QC; the
    // device and the pairing flow never look at it.
    public function updateQc(Request $request, string $deviceId): RedirectResponse
    {
        $data = $request->validate(['qc_status' => ['required', Rule::in(self::QC_STATUSES)]]);
        $device = SecurityDevice::where('device_id', $deviceId)->firstOrFail();

        $device->forceFill(['qc_status' => $data['qc_status']])->save();

        return back()->with('success', "QC modul {$device->device_id}: {$data['qc_status']}.");
    }
}
