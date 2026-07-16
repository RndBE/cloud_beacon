<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Services\ModeProfiles\ModeProfileCatalog;
use App\Services\ModeProfiles\ModeProfilePreviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ModeProfileController extends Controller
{
    public function __construct(
        private readonly ModeProfileCatalog $catalog,
        private readonly ModeProfilePreviewService $previewService,
    ) {}

    public function show(string $mode): JsonResponse
    {
        $profile = $this->catalog->find($mode);

        if (! $profile) {
            return response()->json([
                'success' => false,
                'message' => 'Mode profile tidak ditemukan.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'profile' => $profile,
        ]);
    }

    public function preview(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'id_logger' => ['required', 'string'],
            'mode' => ['required', 'string', 'max:32'],
            'selections' => ['present', 'array'],
            'selections.*' => ['array'],
            'selections.*.role' => ['required', 'string', 'max:64'],
            'selections.*.template_id' => ['required', 'string', 'max:100'],
            'selections.*.inputs' => ['required', 'array'],
        ]);

        $logger = Logger::query()
            ->manageableBy($request->user())
            ->where('device_identifier', $validated['id_logger'])
            ->firstOrFail();

        return response()->json($this->previewService->preview($logger, $validated));
    }
}
