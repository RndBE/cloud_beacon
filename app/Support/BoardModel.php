<?php

namespace App\Support;

/**
 * Board identity helpers shared by controllers and services.
 *
 * The LEO test lives here rather than on either caller so there is exactly one definition of "is
 * this a LEO board": provisioning uses it to force the USB transport, and INFO parsing uses it to
 * label the uplink. Two copies would drift, and both decisions would then disagree about the same
 * device. The frontend mirror is isLeoModel() in resources/js/pages/loggers/protocol.tsx.
 */
class BoardModel
{
    /**
     * True when any of the given identifiers names a LEO-series board.
     *
     * Accepts several candidates (model, serial number, INFO serial) because the registry has rows
     * whose `model` was never filled in, and the serial number then carries the only hint.
     *
     * The negative lookbehind keeps a model like "Galileo" out — it ends in LEO but is not one.
     */
    public static function isLeo(?string ...$candidates): bool
    {
        foreach ($candidates as $candidate) {
            if (is_string($candidate) && preg_match('/(?<![A-Z])LEO/i', $candidate)) {
                return true;
            }
        }

        return false;
    }

    /**
     * BL11LEO / BL11 / BL110 / BL1100, or null when nothing identifies the board.
     *
     * Mirrors inferBoardVariant() in resources/js/pages/loggers/protocol.tsx, in the same order:
     * LEO first (its model also contains "BL11"), then BL1100 before BL110 for the same reason.
     */
    public static function variant(
        ?string $model,
        ?string $serialNumber = null,
        ?string $connectionType = null,
        ?int $channelCount = null,
    ): ?string {
        $normalized = preg_replace('/[^A-Z0-9]/', '', strtoupper($model ?? ''));

        if (self::isLeo($model, $serialNumber)) {
            return 'BL11LEO';
        }
        if (str_contains($normalized, 'BL1100') || ($channelCount ?? 0) >= 8) {
            return 'BL1100';
        }
        if (str_contains($normalized, 'BL110')) {
            return 'BL110';
        }
        if (str_contains($normalized, 'BL11') || $connectionType === 'cellular') {
            return 'BL11';
        }

        return null;
    }

    /**
     * Telemetry slot budget per board (spec §3.17.1 SLOT_TOTAL): 50 on BL1100, 16 on every other
     * variant. The top 7 are reserved for diagnostics, so MAP_DATA can only name the rest —
     * s1..s43 on BL1100 (MAP_SLOT_MAX in the frontend), s1..s9 elsewhere.
     *
     * Null for an unidentified board: there is no budget to check against, and refusing would
     * block every logger whose model was never filled in.
     *
     * @return array{sensor: int, mapping: int}|null
     */
    public static function slotLimits(?string $variant): ?array
    {
        return match ($variant) {
            'BL1100' => ['sensor' => 50, 'mapping' => 43],
            'BL11', 'BL110', 'BL11LEO' => ['sensor' => 16, 'mapping' => 9],
            default => null,
        };
    }
}
