// GCM module fault value (GCM_GATE / GCM_PUMP `fault`): a bitmask, several causes can be set at
// once (e.g. 9 = phase R lost + E-STOP). PUMP modules only report the supply-phase and E-STOP
// bits; the rest belong to the gate controller.
//
// Dependency-free on purpose so tests/Frontend can transpile and exercise it directly.

export type GcmFaultMode = 'AWGC' | 'PUMP';

export type GcmFaultBit = {
    bit: number;
    label: string;
    pump: boolean; // also reported by PUMP modules
    latched?: boolean; // stays set until STOP is sent
};

export const GCM_FAULT_BITS: readonly GcmFaultBit[] = [
    { bit: 1, label: 'Fasa R hilang', pump: true },
    { bit: 2, label: 'Fasa S hilang', pump: true },
    { bit: 4, label: 'Fasa T hilang', pump: true },
    { bit: 8, label: 'E-STOP', pump: true },
    { bit: 16, label: 'Limit konflik', pump: false },
    { bit: 32, label: 'Travel timeout', pump: false, latched: true },
    { bit: 64, label: 'Loop 4–20 mA putus', pump: false },
    { bit: 128, label: 'Macet', pump: false, latched: true },
    { bit: 256, label: 'ADC tidak merespons', pump: false },
];

export type GcmFaultCause = { bit: number; label: string; latched: boolean };

// Every set bit becomes one cause, in table order. A bit the table does not know — or one a PUMP
// module should not report — is still shown as "Kode N" rather than hidden, so an unexpected
// value never reads as a clean bill of health.
export function decodeGcmFault(
    value: unknown,
    mode: GcmFaultMode,
): GcmFaultCause[] {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n <= 0) return [];
    const causes: GcmFaultCause[] = [];
    let remaining = n;
    for (const f of GCM_FAULT_BITS) {
        if (!(n & f.bit)) continue;
        remaining &= ~f.bit;
        causes.push(
            mode === 'PUMP' && !f.pump
                ? { bit: f.bit, label: `Kode ${f.bit}`, latched: false }
                : { bit: f.bit, label: f.label, latched: f.latched === true },
        );
    }
    for (let bit = 1; remaining > 0; bit <<= 1) {
        if (remaining & bit) {
            causes.push({ bit, label: `Kode ${bit}`, latched: false });
            remaining &= ~bit;
        }
    }
    return causes;
}

// The reply may carry the bitmask as `fault_code` (newer firmware) next to `fault`; prefer it.
export function gcmFaultValue(reply: Record<string, unknown>): number {
    const raw = reply.fault_code ?? reply.fault ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}
