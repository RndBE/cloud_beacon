/** Which hardware board a logger is, from its model string / connection / channel count. */

// LEO must be tested before the plain BL11 check: "BL11LEO" satisfies
// includes('BL11') too, and before this branch existed a LEO board was
// classified as cellular — which handed it a SIM/APN card and a SIM GET it can
// never answer (HAS_SIM7600 = 0; its uplink is Iridium satellite).
//
// The `[^A-Z]` guard keeps a model like "Galileo" out. Deliberately written
// without a lookbehind so the module still parses on older Safari — this file
// loads for every logger, not only the LEO ones. Same rule as the backend's
// ProductionController::transportFor(); keep the two in step.
function isLeoModel(model: string | null): boolean {
    return /(?:^|[^A-Z])LEO/.test((model || '').toUpperCase());
}

// Structural param rather than ProtocolLogger so the logger detail page can share this instead of
// keeping its own copy — the two used to drift, and the copy classified LEO as BL11.
export function inferBoardVariant(logger: {
    model: string | null;
    connectionType: string | null;
    channelCount: number | null;
}): 'BL11LEO' | 'BL11' | 'BL110' | 'BL1100' | null {
    const normalized = (logger.model || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (isLeoModel(logger.model)) return 'BL11LEO';
    if (normalized.includes('BL1100') || (logger.channelCount ?? 0) >= 8)
        return 'BL1100';
    if (normalized.includes('BL110')) return 'BL110';
    if (normalized.includes('BL11') || logger.connectionType === 'cellular')
        return 'BL11';
    return null;
}
