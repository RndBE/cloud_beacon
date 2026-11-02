/**
 * Indonesian time zones a logger can sit in.
 *
 * Mirrors Logger::TIMEZONES on the PHP side — keep the two in step. `offset` is
 * what the device RTC takes (the RTC protocol speaks a plain number, not an
 * IANA name); Indonesia observes no DST, so the offset never moves.
 */
export interface LoggerTimezone {
    value: string;
    abbr: string;
    offset: number;
    label: string;
}

export const LOGGER_TIMEZONES: LoggerTimezone[] = [
    {
        value: 'Asia/Jakarta',
        abbr: 'WIB',
        offset: 7,
        label: 'WIB — Waktu Indonesia Barat (UTC+7)',
    },
    {
        value: 'Asia/Makassar',
        abbr: 'WITA',
        offset: 8,
        label: 'WITA — Waktu Indonesia Tengah (UTC+8)',
    },
    {
        value: 'Asia/Jayapura',
        abbr: 'WIT',
        offset: 9,
        label: 'WIT — Waktu Indonesia Timur (UTC+9)',
    },
];

/** WIB / WITA / WIT, or the raw IANA name for a zone outside the list. */
export function timezoneAbbr(name: string | null | undefined): string {
    if (!name) return '';

    return LOGGER_TIMEZONES.find((tz) => tz.value === name)?.abbr ?? name;
}

/** UTC offset in hours, for pre-filling the device RTC card. */
export function timezoneOffset(name: string | null | undefined): number | null {
    if (!name) return null;

    return LOGGER_TIMEZONES.find((tz) => tz.value === name)?.offset ?? null;
}
