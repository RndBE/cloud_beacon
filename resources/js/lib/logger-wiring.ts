/**
 * Terminal layout and wiring recipes of the Beacon logger boards, served to the
 * AI assistant (get_wiring_guide, show_wiring_diagram). Source of truth: the
 * "Penjelasan singkat Pin Logger" note; positions come from the November 2025
 * front-panel stickers (BL-11, BL-110, BL-1100), in the sticker's own points
 * (BL-11 scaled by 1/4 from its Canva artboard). Anything not listed here (wire
 * colours, terminal current limits, Port I/O pinout) is unknown and must not
 * be guessed.
 */
export type Board = 'BL11' | 'BL110' | 'BL1100';

export type Terminal = {
    /** Unique per board; what the assistant passes as `to`. */
    id: string;
    /** Text printed on the sticker. */
    label: string;
    blok: string;
    use: string;
    cx: number;
    cy: number;
    w: number;
    h: number;
    /** Which edge the wire reaches the terminal from. */
    side: 'left' | 'right' | 'bottom';
    /** red = red text (power out), redfill = white on red (+), dark = white on black (-). */
    tone?: 'red' | 'redfill' | 'dark';
    round?: boolean;
};

type Box = { x: number; y: number; w: number; h: number };
type BoardLayout = {
    nama: string;
    kanal: string;
    body: Box;
    title: { text: string; x: number; y: number; w: number; size: number };
    model: { text: string; x: number; y: number };
    display: Box;
    /** Printed ports and slots that are not wire terminals. */
    ports: { text: string; cx: number; cy: number; w?: number; h?: number }[];
    terminals: Terminal[];
    catatan: string[];
};

const OUT24 =
    'keluaran daya 24V untuk sensor (bisa di-ON/OFF-kan lewat set_power_output)';
const OUT12 =
    'keluaran daya 12V untuk sensor (bisa di-ON/OFF-kan lewat set_power_output)';
const OUT5 = 'keluaran daya 5V untuk sensor';
const VIN_PLUS = 'INPUT daya logger, positif (+12/24V)';
const VIN_MINUS = 'INPUT daya logger, negatif';

const KIRI = 'Blok kiri (atas ke bawah)';
const KANAN = 'Blok kanan (atas ke bawah)';
const BAWAH = 'Blok bawah (kiri ke kanan)';
const PINTU = 'Blok sensor pintu (kiri bawah)';

/** Column of terminals on the left edge, `rows` = [id, label, use, tone?]. */
function column(
    blok: string,
    side: Terminal['side'],
    cx: number,
    y0: number,
    pitch: number,
    w: number,
    h: number,
    rows: [string, string, string, Terminal['tone']?][],
): Terminal[] {
    return rows.map(([id, label, use, tone], i) => ({
        id,
        label,
        blok,
        use,
        cx,
        cy: y0 + i * pitch,
        w,
        h,
        side,
        tone,
    }));
}

/** Row of terminals along the bottom edge; `xs` are the cell centres. */
function row(
    cy: number,
    w: number,
    h: number,
    xs: number[],
    rows: [string, string, string, Partial<Terminal>?][],
): Terminal[] {
    return rows.map(([id, label, use, extra], i) => ({
        id,
        label,
        blok: BAWAH,
        use,
        cx: xs[i],
        cy,
        w,
        h,
        side: 'bottom' as const,
        ...extra,
    }));
}

const analog = (n: number): [string, string, string] => [
    `A${n}`,
    `A${n}`,
    `input analog ${n}`,
];

export const BOARDS: Record<Board, BoardLayout> = {
    BL11: {
        nama: 'BL-11 (seluler, slot SIM)',
        kanal: 'Analog 2 (A1-A2), digital 2 (D1-D2), RS232 1 port (Tx/Rx), RS485 1 bus (A/B). Tidak ada rail 12V.',
        body: { x: 0, y: 8, w: 368, h: 173 },
        title: { text: 'Beacon Logger', x: 50, y: 28, w: 81.6, size: 13 },
        model: { text: 'BL-11', x: 172, y: 22 },
        display: { x: 46, y: 33, w: 146.5, h: 32 },
        ports: [
            { text: 'PORT I/O', cx: 170, cy: 76 },
            { text: 'TYPE A', cx: 167.4, cy: 123.2 },
            { text: 'SD CARD', cx: 338.3, cy: 94 },
            { text: 'SIM CARD', cx: 344.6, cy: 127.5 },
            { text: 'GSM', cx: 351.7, cy: 44.1, w: 15, h: 12.5 },
            { text: 'GPS', cx: 351.7, cy: 73, w: 15, h: 12.5 },
            { text: 'USB', cx: 177.7, cy: 167.1, w: 42.3, h: 14.5 },
            { text: 'NET', cx: 211.5, cy: 167.1, w: 11, h: 14.5 },
        ],
        terminals: [
            ...column(KIRI, 'left', 10.5, 35, 11.4, 14.3, 11.4, [
                ['24V', '24V', OUT24, 'red'],
                ['5V', '5V', OUT5, 'red'],
                ['S1', 'S1', 'input sensor pintu'],
                [
                    'G',
                    'G',
                    'negatif daya / GND (juga negatif input analog dan digital)',
                ],
                ['RST', 'RST', 'pin reboot'],
            ]),
            ...row(
                167.1,
                11.3,
                14.5,
                [49.3, 60.8, 72.2, 83.7, 95.1, 106.5, 117.7, 129, 140.2, 151.4],
                [
                    analog(1),
                    analog(2),
                    ['D1', 'D1', 'digital 1 (input/output)'],
                    ['D2', 'D2', 'digital 2 (input/output)'],
                    ['Tx', 'Tx', 'RS232 transmit (port 1)'],
                    ['Rx', 'Rx', 'RS232 receive (port 1)'],
                    ['A', 'A', 'RS485 A'],
                    ['B', 'B', 'RS485 B'],
                    ['VIN+', '+', VIN_PLUS, { tone: 'redfill' }],
                    ['VIN-', '-', VIN_MINUS, { tone: 'dark' }],
                ],
            ),
        ],
        catatan: [
            'Negatif input analog dan digital = terminal G (GND) di blok kiri.',
            'Label NET, GSM dan GPS di stiker tidak dijelaskan di panduan pin.',
        ],
    },
    BL110: {
        nama: 'BL-110 (Ethernet)',
        kanal: 'Analog 2, digital 2, RS232 1 port (Tx1/Rx1), RS485 1 bus (A/B). Ada Ethernet dan rail 12V.',
        body: { x: 0, y: 38, w: 348.7, h: 308 },
        title: { text: 'BEACON LOGGER', x: 79.9, y: 76, w: 136.3, size: 17 },
        model: { text: 'BE-BL110', x: 235, y: 60 },
        display: { x: 78.6, y: 83, w: 191.6, h: 46 },
        ports: [
            { text: 'GPS', cx: 327.5, cy: 108.3, w: 23, h: 16 },
            { text: 'SD CARD', cx: 284.4, cy: 170 },
            { text: 'TYPE C', cx: 240, cy: 202 },
            { text: 'PORT I/O', cx: 254.9, cy: 238 },
            { text: 'ETH', cx: 226, cy: 326.2, w: 62, h: 17 },
            { text: 'USB', cx: 276, cy: 326.2, w: 38, h: 17 },
        ],
        terminals: [
            ...column(KIRI, 'left', 20.2, 72.2, 14.43, 19, 14.4, [
                ['24V', '24V', OUT24, 'red'],
                ['12V', '12V', OUT12, 'red'],
                ['5V', '5V', OUT5, 'red'],
                ['Tx1', 'Tx1', 'RS232 transmit (port 1)'],
                ['Rx1', 'Rx1', 'RS232 receive (port 1)'],
                ['A', 'A', 'RS485 A'],
                ['B', 'B', 'RS485 B'],
                ['S1', 'S1', 'input sensor pintu'],
                ['G', 'G', 'negatif daya'],
                ['RST', 'RST', 'pin reboot'],
            ]),
            ...row(
                326.2,
                14.4,
                17,
                [58, 71.9, 86.6, 101, 115.8, 130.2, 145, 159.4, 173.4, 187.9],
                [
                    analog(1),
                    ['G-A1', 'G', 'negatif analog 1'],
                    analog(2),
                    ['G-A2', 'G', 'negatif analog 2'],
                    ['D1', 'D1', 'digital 1 (input/output)'],
                    ['G-D', 'G', 'negatif port digital (D1 dan D2)'],
                    ['D2', 'D2', 'digital 2 (input/output)'],
                    [
                        'R1',
                        'R1',
                        'relay router (enable router), bukan untuk sensor',
                        { round: true },
                    ],
                    ['VIN+', '+', VIN_PLUS, { tone: 'redfill' }],
                    ['VIN-', '-', VIN_MINUS, { tone: 'dark' }],
                ],
            ),
        ],
        catatan: [],
    },
    BL1100: {
        nama: 'BL-1100 (Ethernet, 8 analog)',
        kanal: 'Analog 8 (A1-A8), digital 4 (D1-D4), RS232 2 port (Tx1/Rx1 dan Tx2/Rx2), RS485 1 bus (A/B). Ada Ethernet dan rail 12V.',
        body: { x: 0, y: 56, w: 351.5, h: 437 },
        title: { text: 'BEACON LOGGER', x: 67.2, y: 101, w: 147.7, size: 19 },
        model: { text: 'BE-BL1100', x: 236, y: 90 },
        display: { x: 63.7, y: 108, w: 223, h: 82 },
        ports: [
            { text: 'GPS', cx: 325.6, cy: 151.7, w: 22, h: 17.7 },
            { text: 'SD CARD', cx: 308, cy: 298 },
            { text: 'TYPE C', cx: 269.7, cy: 337.6 },
            { text: 'PORT I/O', cx: 270.3, cy: 375 },
            { text: 'ETH', cx: 229.2, cy: 470.3, w: 59.4, h: 18 },
            { text: 'USB', cx: 279, cy: 470.3, w: 40, h: 18 },
        ],
        terminals: [
            ...column(KIRI, 'left', 22, 90.3, 14.4, 19, 14.2, [
                ['24V', '24V', OUT24, 'red'],
                ['12V', '12V', OUT12, 'red'],
                ['5V', '5V', OUT5, 'red'],
                ['Tx2', 'Tx2', 'RS232 transmit (port 2)'],
                ['Rx2', 'Rx2', 'RS232 receive (port 2)'],
                ['Tx1', 'Tx1', 'RS232 transmit (port 1)'],
                ['Rx1', 'Rx1', 'RS232 receive (port 1)'],
                ['A', 'A', 'RS485 A'],
                ['B', 'B', 'RS485 B'],
                [
                    'G',
                    'G',
                    'negatif daya / GND (juga negatif input analog dan digital)',
                ],
            ]),
            ...column(PINTU, 'left', 23.3, 304, 17.5, 19, 16, [
                ['S1', 'S1', 'input sensor pintu'],
                ['G-S1', 'G', 'negatif sensor pintu'],
            ]),
            ...column(KANAN, 'right', 327.9, 334.2, 14.46, 18, 14.2, [
                [
                    'R1',
                    'R1',
                    'relay router (enable router), bukan untuk sensor',
                ],
                ['D4', 'D4', 'digital 4 (input/output)'],
                ['D3', 'D3', 'digital 3 (input/output)'],
                ['D2', 'D2', 'digital 2 (input/output)'],
                ['D1', 'D1', 'digital 1 (input/output)'],
                ['RST', 'RST', 'pin reboot'],
            ]).map((t) => (t.id === 'R1' ? { ...t, round: true } : t)),
            ...row(
                470.3,
                14.4,
                18,
                [
                    60.1, 74.5, 89.1, 103.8, 118.4, 133.1, 147.7, 162.4, 176.9,
                    191.9,
                ],
                [
                    analog(1),
                    analog(2),
                    analog(3),
                    analog(4),
                    analog(5),
                    analog(6),
                    analog(7),
                    analog(8),
                    ['VIN+', '+', VIN_PLUS, { tone: 'redfill' }],
                    ['VIN-', '-', VIN_MINUS, { tone: 'dark' }],
                ],
            ),
        ],
        catatan: [
            'Negatif input analog (A1-A8) dan digital (D1-D4) = terminal G (GND) di blok kiri, sama dengan negatif daya.',
        ],
    },
};

/** Colours only tell the lines apart in the picture; they are not real wire colours. */
export const WIRE_COLORS = {
    red: '#dc2626',
    black: '#1f2937',
    blue: '#2563eb',
    green: '#16a34a',
    yellow: '#ca8a04',
    orange: '#ea580c',
} as const;
export type WireColor = keyof typeof WIRE_COLORS;
export type WiringSpec = {
    board: Board;
    sensor: string;
    wires: { from: string; to: string; color: WireColor }[];
};

export function terminalOf(board: Board, id: string): Terminal | undefined {
    const wanted = id.trim().toLowerCase();
    return BOARDS[board].terminals.find((t) => t.id.toLowerCase() === wanted);
}

/** Terminal list for the assistant, grouped by block: "id = function". */
export function describeTerminals(board: Board): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const t of BOARDS[board].terminals) {
        const printed = t.label !== t.id ? ` (tercetak "${t.label}")` : '';
        (out[t.blok] ??= []).push(`${t.id}${printed} = ${t.use}`);
    }
    return out;
}

export const RECIPES: Record<string, string[]> = {
    'Analog 4-20 mA': [
        'Kabel: catu sensor dari rail 24V/12V sesuai datasheet, kabel keluaran sensor ke A# yang dipilih. Sensor 2 kabel (loop): + sensor ke rail, kabel sisanya ke A#. Sensor 3/4 kabel: + ke rail, − ke negatif, sinyal ke A#. Negatif: BL-110 pakai terminal G di sebelah tiap A# (id G-A1, G-A2); BL-11 dan BL-1100 pakai terminal G (GND) di blok kiri.',
        'Setup: add_sensor connection_type=analog, analog_mode=1, channel=#, min_value = nilai di 4 mA, max_value = nilai di 20 mA (dari rentang ukur sensor), unit.',
        'Kalibrasi opsional: calibrate_analog_input (gain / offset) dengan kalibrator.',
    ],
    'Analog 0-10 V': [
        'Kabel: seperti 4-20 mA, tetapi sensor 3 kabel dengan keluaran tegangan. Keluaran sensor tidak boleh melebihi 10 V.',
        'Setup: add_sensor connection_type=analog, analog_mode=0, channel=#, min_value = nilai di 0 V, max_value = nilai di 10 V, unit.',
    ],
    'RS485 Modbus': [
        'Kabel: A sensor ke A logger, B sensor ke B logger, catu dari rail sesuai datasheet, negatif sensor ke negatif catu. Beberapa sensor boleh paralel di A/B asal slave id berbeda. Kalau tidak ada balasan, tukar A dan B.',
        'Setup: add_rs485_device dengan modbus_slave_id (1-10, unik per logger), function_code (3 atau 4), baudrate, serial_format, dan params (nama maks 12 karakter, register_address, reg_count = kode tipe data, scale_factor, unit) dari peta register di datasheet.',
    ],
    RS232: [
        'Kabel: Tx sensor ke Rx logger, Rx sensor ke Tx logger (silang), negatif bersama. Catu sensor dari rail sesuai datasheet.',
        'Setup: add_sensor connection_type=rs232, port (1, BL-1100 juga 2), scale_factor, unit. GNSS memakai RS232 (mode GNSS).',
    ],
    'Pulsa (tipping bucket, flow meter)': [
        'Kabel: dua kabel kontak/pulsa sensor ke D# dan negatif digital (BL-110: G-D; BL-11 dan BL-1100: G di blok kiri).',
        'Setup: add_sensor connection_type=digital, digital_mode 1 (hitungan hilang saat reboot) atau 2 (tersimpan), pulse_submode 0 counter / 1 rate / 2 auto reset, scale_factor = nilai per pulsa dari datasheet, timeout_sec, debounce_ms.',
    ],
    'Kontak / status (float switch dan sejenisnya)': [
        'Kabel: kontak ke D# dan negatif digital (BL-110: G-D; BL-11 dan BL-1100: G di blok kiri).',
        'Setup: add_sensor connection_type=digital, digital_mode=0, label_high, label_low, debounce_ms, invert_logic.',
    ],
    'Sensor pintu': [
        'Kabel: kontak pintu ke S1 dan negatifnya (BL-1100: G-S1; BL-11 dan BL-110: G di blok kiri). Polaritas lewat set_door_sensor.',
    ],
    'Output relay (aktuator)': [
        'Batas arus/tegangan terminal D belum ada di panduan pin. Minta pengguna cek spesifikasi atau tim Beacon sebelum menyambung beban.',
        'Setup: configure_digital_output, lalu uji dengan set_digital_output.',
    ],
};

export const STEPS = [
    '1. Tentukan logger dan papannya (pakai logger_id). Lihat kanal yang masih kosong di "terpakai".',
    '2. Tanya sensornya: tipe, besaran yang diukur, jenis keluaran (4-20 mA, 0-10 V, RS485, RS232, pulsa, kontak) dan tegangan catunya. Jangan menebak.',
    '3. Susun kabelnya satu per satu: "kabel X sensor ke terminal Y (blok kiri/bawah/kanan)", pakai label persis di stiker. Sebut hanya fakta dari data ini; yang belum terkonfirmasi katakan belum terkonfirmasi, jangan menjelaskan cara kerja internal terminal.',
    '4. Panggil show_wiring_diagram (board, sensor, wires dengan id terminal dari daftar ini) supaya pengguna melihat gambarnya. Warna di gambar hanya penanda, bukan warna kabel sensor. Teksnya cukup ringkas karena gambar sudah menjelaskan.',
    '5. Ingatkan: sambungkan saat catu logger atau rail sensor mati, cek polaritas, kencangkan sekrup terminal.',
    '6. Tunggu pengguna menjawab sudah terpasang. Jangan mengonfigurasi sebelum itu.',
    '7. Konfigurasi sesuai resep (add_sensor / add_rs485_device; set_logger_mode dan set_calibration bila mode membutuhkannya). Logger harus online.',
    '8. Verifikasi: read_sensor_names memberi nilai langsung dari perangkat. Minta pengguna membandingkan dengan nilai yang masuk akal atau alat ukur. Lalu get_logger untuk memastikan sensor tercatat; data historis muncul setelah interval kirim berikutnya.',
    '9. Kalau nilai tidak masuk akal, pakai daftar masalah di bawah, perbaiki, ulangi langkah 7-8.',
];

export const TROUBLESHOOTING = [
    'Analog menempel di batas bawah atau 0: kabel longgar/putus, catu sensor mati, kanal salah, atau mode salah (4-20 mA vs 0-10 V).',
    'Analog salah proporsi: min_value/max_value tidak sesuai rentang sensor; koreksi dengan calibrate_analog_input.',
    'RS485 tidak ada nilai: A/B tertukar, slave id duplikat, baudrate/serial_format/function_code/register_address tidak cocok datasheet, atau catu sensor mati.',
    'RS485 nilai aneh: reg_count (tipe data / urutan byte) atau scale_factor salah.',
    'RS232 kosong: Tx/Rx tidak disilang, baudrate beda, atau port salah (BL-1100 punya port 1 dan 2).',
    'Pulsa tidak bertambah: kabel di D# salah, negatif belum tersambung, debounce terlalu besar, atau digital_mode salah.',
    'Perintah gagal/timeout: logger offline. Cek status dengan get_logger atau poll_all_loggers.',
];
