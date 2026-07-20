<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\RemoteDevice;
use App\Services\CloudWebTargetPolicy;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator as ValidatorFacade;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;
use Inertia\Inertia;
use Inertia\Response;

class RemoteDeviceController extends Controller
{
    private const DEFAULT_WEB_ENABLED = false;

    private const DEFAULT_WEB_PORT = 80;

    public function __construct(private readonly CloudWebTargetPolicy $cloudWebTargetPolicy) {}

    public function index(): Response
    {
        $devices = RemoteDevice::with('loggers:id,remote_device_id')
            ->orderBy('name')
            ->get()
            ->map(fn (RemoteDevice $d) => [
                'id' => $d->id,
                'name' => $d->name,
                'host' => $d->host,
                'port' => $d->port,
                'username' => $d->username,
                'description' => $d->description,
                'webEnabled' => $d->web_enabled,
                'webSlug' => $d->web_slug,
                'webPort' => $d->web_port,
                'webUrl' => $d->web_slug
                    ? 'https://'.$d->web_slug.'.'.config('cloud-web.base_domain')
                    : null,
                'loggerIds' => $d->loggers->modelKeys(),
                'createdAt' => $d->created_at?->format('Y-m-d H:i'),
            ]);

        $availableLoggers = Logger::query()
            ->with('remoteDevice:id,name')
            ->orderBy('name')
            ->get()
            ->map(fn (Logger $logger) => [
                'id' => $logger->id,
                'name' => $logger->name,
                'serialNumber' => $logger->serial_number,
                'remoteDeviceId' => $logger->remote_device_id,
                'remoteDeviceName' => $logger->remoteDevice?->name,
            ]);

        return Inertia::render('cloud-ssh/index', [
            'devices' => $devices,
            'availableLoggers' => $availableLoggers,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validateDevice($request);

        $device = DB::transaction(function () use ($validated): RemoteDevice {
            $device = RemoteDevice::create($validated);
            $device->ensureWebSlug();
            $this->syncLoggers($device, $validated['logger_ids'] ?? []);

            return $device->refresh();
        });

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "'.$device->name.'" berhasil ditambahkan.');
    }

    public function update(Request $request, RemoteDevice $device): RedirectResponse
    {
        $validated = $this->validateDevice($request, $device);

        $device = DB::transaction(function () use ($device, $validated): RemoteDevice {
            $device->update($validated);
            $device->ensureWebSlug();

            if (array_key_exists('logger_ids', $validated)) {
                $this->syncLoggers($device, $validated['logger_ids']);
            }

            return $device->refresh();
        });

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "'.$device->name.'" berhasil diperbarui.');
    }

    public function destroy(RemoteDevice $device): RedirectResponse
    {
        $name = $device->name;
        $device->delete();

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "'.$name.'" berhasil dihapus.');
    }

    /**
     * @return array{name: string, host: string, port: int, username: string, description: ?string, web_enabled?: bool, web_port?: int, logger_ids?: array<int, int>}
     */
    private function validateDevice(Request $request, ?RemoteDevice $device = null): array
    {
        $validator = ValidatorFacade::make($request->all(), [
            'name' => 'required|string|max:255',
            'host' => 'required|string|max:255',
            'port' => 'required|integer|min:1|max:65535',
            'username' => 'required|string|max:64|regex:/^[a-z_][a-z0-9_.-]*$/i',
            'description' => 'nullable|string|max:255',
            'web_enabled' => ['sometimes', 'boolean'],
            'web_port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'logger_ids' => ['sometimes', 'array'],
            'logger_ids.*' => ['integer', 'distinct', 'exists:loggers,id'],
        ]);

        $effectiveWebEnabled = $request->exists('web_enabled')
            ? $request->boolean('web_enabled')
            : ($device?->web_enabled ?? self::DEFAULT_WEB_ENABLED);
        $requestedHost = $request->input('host', $device?->host ?? '');
        $effectiveHost = is_string($requestedHost) ? $requestedHost : '';
        $requestedWebPort = $request->input('web_port', $device?->web_port ?? self::DEFAULT_WEB_PORT);
        $effectiveWebPort = is_scalar($requestedWebPort) ? (int) $requestedWebPort : 0;

        $validator->after(function (Validator $validator) use (
            $request,
            $device,
            $effectiveWebEnabled,
            $effectiveHost,
            $effectiveWebPort,
        ): void {
            if ($effectiveWebEnabled
                && ! $validator->errors()->has('web_enabled')
                && ! $validator->errors()->has('host')
                && ! $validator->errors()->has('web_port')
                && ! $this->cloudWebTargetPolicy->allows($effectiveHost, $effectiveWebPort)) {
                $validator->errors()->add('host', 'The web target must be an allowed IPv4 address and port.');
            }

            if ($validator->errors()->has('logger_ids')) {
                return;
            }

            $loggerIds = collect($request->input('logger_ids', []))
                ->filter(fn ($id) => is_numeric($id))
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values();

            if ($loggerIds->isEmpty()) {
                return;
            }

            $hasConflict = Logger::query()
                ->whereIn('id', $loggerIds)
                ->whereNotNull('remote_device_id')
                ->when($device, fn ($query) => $query->where('remote_device_id', '!=', $device->id))
                ->exists();

            if ($hasConflict) {
                $validator->errors()->add('logger_ids', 'Salah satu Logger sudah terhubung ke Modul AI lain.');
            }
        });

        return $validator->validate();
    }

    /**
     * @param  array<int, int|string>  $loggerIds
     */
    private function syncLoggers(RemoteDevice $device, array $loggerIds): void
    {
        $loggerIds = collect($loggerIds)
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        $selectedLoggers = Logger::query()
            ->whereIn('id', $loggerIds)
            ->lockForUpdate()
            ->get();

        if ($selectedLoggers->contains(
            fn (Logger $logger) => $logger->remote_device_id !== null
                && $logger->remote_device_id !== $device->id
        )) {
            throw ValidationException::withMessages([
                'logger_ids' => 'Salah satu Logger sudah terhubung ke Modul AI lain.',
            ]);
        }

        Logger::query()
            ->where('remote_device_id', $device->id)
            ->when($loggerIds->isNotEmpty(), fn ($query) => $query->whereNotIn('id', $loggerIds))
            ->update(['remote_device_id' => null]);

        if ($loggerIds->isNotEmpty()) {
            Logger::whereIn('id', $loggerIds)
                ->update(['remote_device_id' => $device->id]);
        }
    }
}
