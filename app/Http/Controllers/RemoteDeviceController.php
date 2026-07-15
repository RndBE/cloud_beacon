<?php

namespace App\Http\Controllers;

use App\Models\RemoteDevice;
use App\Services\CloudWebTargetPolicy;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator as ValidatorFacade;
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
        $devices = RemoteDevice::orderBy('name')
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
                'createdAt' => $d->created_at?->format('Y-m-d H:i'),
            ]);

        return Inertia::render('cloud-ssh/index', [
            'devices' => $devices,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validateDevice($request);

        $device = DB::transaction(function () use ($validated): RemoteDevice {
            $device = RemoteDevice::create($validated);
            $device->ensureWebSlug();

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
     * @return array{name: string, host: string, port: int, username: string, description: ?string, web_enabled?: bool, web_port?: int}
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
        ]);

        $effectiveWebEnabled = $request->exists('web_enabled')
            ? $request->boolean('web_enabled')
            : ($device?->web_enabled ?? self::DEFAULT_WEB_ENABLED);
        $requestedHost = $request->input('host', $device?->host ?? '');
        $effectiveHost = is_string($requestedHost) ? $requestedHost : '';
        $requestedWebPort = $request->input('web_port', $device?->web_port ?? self::DEFAULT_WEB_PORT);
        $effectiveWebPort = is_scalar($requestedWebPort) ? (int) $requestedWebPort : 0;

        $validator->after(function (Validator $validator) use (
            $effectiveWebEnabled,
            $effectiveHost,
            $effectiveWebPort,
        ): void {
            if (! $effectiveWebEnabled
                || $validator->errors()->has('web_enabled')
                || $validator->errors()->has('host')
                || $validator->errors()->has('web_port')) {
                return;
            }

            if (! $this->cloudWebTargetPolicy->allows($effectiveHost, $effectiveWebPort)) {
                $validator->errors()->add('host', 'The web target must be an allowed IPv4 address and port.');
            }
        });

        return $validator->validate();
    }
}
