<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Services\IdHasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class IntegrationController extends Controller
{
    /**
     * POST /loggers/{id}/integrations
     * Create a new platform integration for a logger.
     */
    public function store(Request $request, string $hash): RedirectResponse
    {
        $logger = $this->resolveLogger($hash);

        $validated = $request->validate([
            'name'             => 'required|string|max:255',
            'endpoint_url'     => 'required|url|max:500',
            'auth_type'        => 'required|in:none,api_key,bearer,basic,custom_header',
            'auth_config'      => 'nullable|array',
            'auth_config.header'    => 'nullable|string|max:100',
            'auth_config.value'     => 'nullable|string|max:500',
            'auth_config.username'  => 'nullable|string|max:255',
            'auth_config.password'  => 'nullable|string|max:255',
            'interval_minutes' => 'required|integer|min:1|max:1440',
            'raw_forward'      => 'boolean',
            'is_enabled'       => 'boolean',
        ]);

        $logger->integrations()->create($validated);

        return back()->with('success', "Integrasi \"{$validated['name']}\" berhasil ditambahkan.");
    }

    /**
     * PUT /loggers/{id}/integrations/{iid}
     * Update an existing integration.
     */
    public function update(Request $request, string $hash, int $iid): RedirectResponse
    {
        $logger      = $this->resolveLogger($hash);
        $integration = $logger->integrations()->findOrFail($iid);

        $validated = $request->validate([
            'name'             => 'required|string|max:255',
            'endpoint_url'     => 'required|url|max:500',
            'auth_type'        => 'required|in:none,api_key,bearer,basic,custom_header',
            'auth_config'      => 'nullable|array',
            'auth_config.header'    => 'nullable|string|max:100',
            'auth_config.value'     => 'nullable|string|max:500',
            'auth_config.username'  => 'nullable|string|max:255',
            'auth_config.password'  => 'nullable|string|max:255',
            'interval_minutes' => 'required|integer|min:1|max:1440',
            'raw_forward'      => 'boolean',
            'is_enabled'       => 'boolean',
        ]);

        $integration->update($validated);

        return back()->with('success', "Integrasi \"{$integration->name}\" berhasil diperbarui.");
    }

    /**
     * DELETE /loggers/{id}/integrations/{iid}
     * Remove an integration.
     */
    public function destroy(string $hash, int $iid): RedirectResponse
    {
        $logger      = $this->resolveLogger($hash);
        $integration = $logger->integrations()->findOrFail($iid);
        $name        = $integration->name;

        $integration->delete();

        return back()->with('success', "Integrasi \"{$name}\" berhasil dihapus.");
    }

    /**
     * PATCH /loggers/{id}/integrations/{iid}/toggle
     * Toggle is_enabled for a specific integration.
     */
    public function toggle(Request $request, string $hash, int $iid): JsonResponse
    {
        $logger      = $this->resolveLogger($hash);
        $integration = $logger->integrations()->findOrFail($iid);

        $integration->update(['is_enabled' => ! $integration->is_enabled]);

        return response()->json([
            'success'    => true,
            'is_enabled' => $integration->is_enabled,
        ]);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private function resolveLogger(string $hash): Logger
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());

        return $query->findOrFail($id);
    }
}
