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
}
