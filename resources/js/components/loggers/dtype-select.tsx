import { Check, ChevronDown } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Modbus data type codes (dtype) ───────────────────────────────────────────
//
// Extracted from loggers/show.tsx so the Mode Profiles editor uses the same picker and the same
// 27-code table. A second copy of this table would drift, and a wrong code writes a sensor the
// firmware decodes as the wrong data type.
// The `reg_count` field carries the Modbus data TYPE code (1..27), not a literal register
// count — the firmware derives the register span from the code. Source of truth: MB_TYPE_TABLE
// in the firmware (see docs/modbus_data_type_codes.md). The cloud only stores/forwards the code.
// The picker mirrors a Modbus-Poll-style cascading menu: pick a type, then its byte order. 16-bit
// types have no byte-order choice; code 4 (U32 bulat.pecahan) is a locked legacy mode kept reachable.
const DTYPE_BYTE_ORDERS = [
    'Big-endian',
    'Little-endian',
    'Big-endian byte swap',
    'Little-endian byte swap',
] as const;

type DtypeGroup =
    | { kind: 'single'; code: number; label: string; note: string }
    | { kind: 'sub'; label: string; codes: [number, number, number, number] };

// Order within each `codes` tuple matches DTYPE_BYTE_ORDERS (BE, LE, BE swap, LE swap).
export const DTYPE_GROUPS: DtypeGroup[] = [
    { kind: 'single', code: 3, label: 'Signed', note: '16-bit' }, // INT16
    { kind: 'single', code: 1, label: 'Unsigned', note: '16-bit' }, // UINT16 (legacy code 1)
    { kind: 'sub', label: '32 Bit signed', codes: [9, 10, 11, 12] }, // INT32
    { kind: 'sub', label: '32 Bit unsigned', codes: [5, 6, 7, 8] }, // UINT32
    { kind: 'sub', label: '64 Bit signed', codes: [20, 21, 22, 23] }, // INT64
    { kind: 'sub', label: '64 Bit unsigned', codes: [16, 17, 18, 19] }, // UINT64
    { kind: 'sub', label: '32 Bit float', codes: [2, 13, 14, 15] }, // FLOAT32 (BE = legacy code 2)
    { kind: 'sub', label: '64 Bit double', codes: [24, 25, 26, 27] }, // FLOAT64
    { kind: 'single', code: 4, label: 'U32 bulat.pecahan', note: 'legacy' }, // locked legacy
];

// Reverse lookup: dtype code → compact label for the trigger button.
export function dtypeLabel(code: number): string {
    for (const g of DTYPE_GROUPS) {
        if (g.kind === 'single' && g.code === code)
            return `${g.label} (${g.note})`;
        if (g.kind === 'sub') {
            const idx = g.codes.indexOf(code);
            if (idx >= 0) return `${g.label} · ${DTYPE_BYTE_ORDERS[idx]}`;
        }
    }
    return `Kode ${code}`;
}

// A 16px slot that holds the check mark for the selected row (keeps every row left-aligned
// whether or not it is the current selection).
function DtypeCheck({ active }: { active: boolean }) {
    return (
        <span className="flex size-4 shrink-0 items-center justify-center">
            {active && <Check className="size-4" />}
        </span>
    );
}

// Cascading data-type picker (Modbus-Poll style): pick a type, then a byte order.
export function DtypeSelect({
    value,
    onChange,
}: {
    value: number;
    onChange: (code: number) => void;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={dtypeLabel(value)}
                >
                    <span className="min-w-0 truncate">
                        {dtypeLabel(value)}
                    </span>
                    <ChevronDown className="size-4 shrink-0 opacity-50" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
                {DTYPE_GROUPS.map((g) => {
                    if (g.kind === 'single') {
                        const active = value === g.code;
                        const row = (
                            <DropdownMenuItem
                                key={g.code}
                                onSelect={() => onChange(g.code)}
                                className={
                                    active
                                        ? 'font-medium text-primary'
                                        : undefined
                                }
                            >
                                <DtypeCheck active={active} />
                                <span>{g.label}</span>
                                {g.note === 'legacy' && (
                                    <span className="ml-auto text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                                        legacy
                                    </span>
                                )}
                            </DropdownMenuItem>
                        );
                        // Set the trailing legacy entry (code 4) off with a separator.
                        return g.code === 4
                            ? [<DropdownMenuSeparator key="dtype-sep" />, row]
                            : row;
                    }
                    const activeInSub = g.codes.includes(value);
                    return (
                        <DropdownMenuSub key={g.label}>
                            <DropdownMenuSubTrigger
                                className={
                                    activeInSub
                                        ? 'font-medium text-primary'
                                        : undefined
                                }
                            >
                                {g.label}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-52">
                                {g.codes.map((code, i) => {
                                    const active = value === code;
                                    return (
                                        <DropdownMenuItem
                                            key={code}
                                            onSelect={() => onChange(code)}
                                            className={
                                                active
                                                    ? 'font-medium text-primary'
                                                    : undefined
                                            }
                                        >
                                            <DtypeCheck active={active} />
                                            <span>{DTYPE_BYTE_ORDERS[i]}</span>
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
