<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Services\ModeProfiles\ModeProfileApplyService;
use App\Services\ModeProfiles\ModeProfileCatalog;
use App\Services\ModeProfiles\ModeProfilePreviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ModeProfileController extends Controller
{
    public function __construct(
        private readonly ModeProfileCatalog $catalog,
        private readonly ModeProfilePreviewService $previewService,
        private readonly ModeProfileApplyService $applyService,
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
        $validated = $this->validateProfileRequest($request);

        $logger = $this->resolveManageableLogger($request, $validated['id_logger']);

        return response()->json($this->previewService->preview($logger, $validated));
    }

    public function apply(Request $request): JsonResponse
    {
        $validated = $this->validateProfileRequest($request, true);
        $logger = $this->resolveManageableLogger($request, $validated['id_logger']);
        $result = $this->applyService->apply($logger, $validated);
        $statusCode = (int) ($result['status_code'] ?? 200);
        unset($result['status_code']);

        return response()->json($result, $statusCode);
    }

    public function importSerialApply(Request $request): JsonResponse
    {
        $validated = $this->validateProfileRequest($request, true);
        $logger = $this->resolveManageableLogger($request, $validated['id_logger']);
        $result = $this->applyService->persistSerialApply($logger, $validated);
        $statusCode = (int) ($result['status_code'] ?? 200);
        unset($result['status_code']);

        return response()->json($result, $statusCode);
    }

    private function validateProfileRequest(Request $request, bool $apply = false): array
    {
        $rules = [
            'id_logger' => ['required', 'string'],
            'mode' => ['required', 'string', 'max:32'],
            'selections' => ['present', 'array'],
            'selections.*' => ['array'],
            'selections.*.role' => ['required', 'string', 'max:64'],
            'selections.*.template_id' => ['required', 'string', 'max:100'],
            'selections.*.inputs' => ['required', 'array'],
        ];

        if ($apply) {
            $rules['confirmed_warnings'] = ['sometimes', 'array'];
            $rules['confirmed_warnings.*'] = ['string', 'max:100'];
        }

        return $request->validate($rules);
    }

    private function resolveManageableLogger(Request $request, string $deviceIdentifier): Logger
    {
        return Logger::query()
            ->manageableBy($request->user())
            ->where('device_identifier', $deviceIdentifier)
            ->firstOrFail();
    }
}
