<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;
use DateTimeImmutable;
use Illuminate\Http\Request;
use Inertia\Inertia;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Data Masuk — raw incoming readings for one logger on one day, one row per
 * recorded timestamp and one column per sensor slot. Mirrors the mini-stesy
 * "Data Masuk" page, but pivots sensor_logs (one row per sensor per minute)
 * instead of reading a wide sensor1..N table.
 */
class DataMasukController extends Controller
{
    public function __construct(private DataAuditService $audits) {}

    public function index(Request $request)
    {
        $loggers = Logger::query()
            ->visibleTo(auth()->user())
            ->orderBy('name')
            ->get(['id', 'name', 'device_identifier'])
            ->map->only('id', 'name', 'device_identifier')
            ->values();

        $date = $this->resolveDate($request);
        $logger = $request->filled('logger')
            ? $this->resolveLogger($request->integer('logger'))
            : null;

        return Inertia::render('data-masuk/index', [
            'loggers' => $loggers,
            'date' => $date->toDateString(),
            'today' => Carbon::today()->toDateString(),
            'logger' => $logger?->only('id', 'name', 'device_identifier'),
            'result' => $logger ? $this->buildTable($logger, $date) : null,
        ]);
    }

    public function export(Request $request, int $id): BinaryFileResponse
    {
        $logger = $this->resolveLogger($id);
        $date = $this->resolveDate($request);
        $table = $this->buildTable($logger, $date);

        $slug = preg_replace('/[^A-Za-z0-9_-]+/', '-', (string) ($logger->device_identifier ?: $logger->id));
        $path = tempnam(sys_get_temp_dir(), 'data-masuk-');
        $this->writeWorkbook($path, $logger, $date, $table);

        return response()
            ->download($path, "data-masuk_{$slug}_{$date->toDateString()}.xlsx", [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ])
            ->deleteFileAfterSend();
    }

    /**
     * Sheet "Data": one row per timestamp, with real numbers and a real
     * date-time in Waktu so Excel can sort, filter and chart without the
     * decimal-separator guessing a CSV triggers on Indonesian locales.
     * Sheet "Info": which logger and day the file covers.
     */
    private function writeWorkbook(string $path, Logger $logger, Carbon $date, array $table): void
    {
        $header = new Style(fontBold: true, backgroundColor: 'E2E8F0');
        $label = new Style(fontBold: true);
        $timestamp = new Style(format: 'yyyy-mm-dd hh:mm:ss');

        $writer = new Writer;
        $writer->openToFile($path);

        $sheet = $writer->getCurrentSheet();
        $sheet->setName('Data');
        // Keep the header row and the No / Waktu columns in view while scrolling.
        $sheet->setSheetView(new SheetView(freezeRow: 2, freezeColumn: 'C'));
        $sheet->setColumnWidth(6, 1);
        $sheet->setColumnWidth(20, 2);
        if ($table['columns']) {
            $sheet->setColumnWidthForRange(18, 3, count($table['columns']) + 2);
        }

        $titles = ['No', 'Waktu'];
        foreach ($table['columns'] as $column) {
            $titles[] = $column['unit'] ? "{$column['name']} ({$column['unit']})" : $column['name'];
        }
        // StringCell, not Cell::fromValue: a device-sent name starting with "=" must stay text, not become a formula.
        $writer->addRow(new Row(array_map(fn (string $title) => new StringCell($title, $header), $titles)));

        $day = $date->toDateString();
        foreach ($table['rows'] as $i => $row) {
            $time = array_shift($row);
            $writer->addRow(Row::fromValuesWithStyles(
                [$i + 1, new DateTimeImmutable("{$day} {$time}"), ...$row],
                [1 => $timestamp],
            ));
        }

        $info = $writer->addNewSheetAndMakeItCurrent();
        $info->setName('Info');
        $info->setColumnWidth(18, 1);
        $info->setColumnWidth(40, 2);

        $completeness = $table['expected'] > 0
            ? sprintf('%.2f%% (%d / %d menit)', min(100, $table['present'] / $table['expected'] * 100), $table['present'], $table['expected'])
            : '-';

        foreach ([
            ['Logger', (string) $logger->name],
            ['ID Logger', (string) $logger->device_identifier],
            ['Tanggal', $day],
            ['Total data', $table['total']],
            ['Kelengkapan', $completeness],
            ['Diekspor', now()->format('Y-m-d H:i:s')],
        ] as [$key, $value]) {
            $writer->addRow(new Row([
                new StringCell($key, $label),
                is_int($value) ? Cell::fromValue($value) : new StringCell($value, null),
            ]));
        }

        $writer->close();
    }

    private function resolveLogger(int $id): Logger
    {
        return Logger::query()->visibleTo(auth()->user())->findOrFail($id);
    }

    /** Requested day, defaulting to today; future dates clamp to today. */
    private function resolveDate(Request $request): Carbon
    {
        $request->validate(['date' => ['nullable', 'date_format:Y-m-d']]);

        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()))->startOfDay();

        return $date->gt(Carbon::today()) ? Carbon::today() : $date;
    }

    /**
     * Pivot one day of sensor_logs into rows of [time, value per column].
     *
     * Reads through the base query builder so a busy logger (31 sensors,
     * ~45k log rows a day) does not hydrate an Eloquent model and a Carbon
     * instance per reading.
     *
     * @return array{columns: list<array{key: string, name: string, unit: ?string}>, rows: list<array>, total: int, present: int, expected: int, first: ?string, last: ?string}
     */
    private function buildTable(Logger $logger, Carbon $date): array
    {
        $day = $date->copy()->startOfDay();

        $logs = SensorLog::query()
            ->where('logger_id', $logger->id)
            ->whereBetween('recorded_at', [$day, $day->copy()->endOfDay()])
            ->orderBy('recorded_at')
            ->select(['recorded_at', 'sensor_key', 'sensor_name', 'value', 'unit'])
            ->toBase()
            ->cursor();

        $columns = [];
        $byTime = [];
        foreach ($logs as $log) {
            $time = (string) $log->recorded_at;
            // Latest reading of the day wins, so a sensor renamed mid-day shows its current name.
            $columns[$log->sensor_key] = [
                'key' => $log->sensor_key,
                'name' => $log->sensor_name,
                // Devices send "-" for unitless values (status flags, counters).
                'unit' => in_array(trim((string) $log->unit), ['', '-'], true) ? null : $log->unit,
            ];
            $byTime[$time][$log->sensor_key] = (float) $log->value;
        }

        // sensor2 before sensor10.
        uksort($columns, 'strnatcasecmp');
        $keys = array_keys($columns);

        $rows = [];
        $minutes = [];
        foreach ($byTime as $time => $values) {
            $row = [substr($time, 11, 8)];
            foreach ($keys as $key) {
                $row[] = $values[$key] ?? null;
            }
            $rows[] = $row;
            // Minute key, same rule as DataAuditService, so completeness matches Data Audit.
            $minutes[substr($time, 0, 16)] = true;
        }

        $times = array_keys($byTime);

        return [
            'columns' => array_values($columns),
            'rows' => $rows,
            'total' => count($rows),
            'present' => count($minutes),
            'expected' => $this->audits->expectedFor($date),
            'first' => $times ? substr($times[0], 11, 8) : null,
            'last' => $times ? substr(end($times), 11, 8) : null,
        ];
    }
}
