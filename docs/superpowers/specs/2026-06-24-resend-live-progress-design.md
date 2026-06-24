# Live Progress untuk Kirim Ulang Forwarding — Design Spec

**Tanggal:** 2026-06-24
**Status:** Disetujui (siap rencana implementasi)

## Latar Belakang

Fitur kirim-ulang (resend) forwarding saat ini fire-and-forget: klik "Kirim ulang N
gagal" → POST `/data-audit/{id}/resend` → dispatch N job `ResendForwarding` ke queue
`default` → angka rekonsiliasi baru ter-update kalau halaman di-reload. Tidak ada jejak
in-flight: job yang masih antri tak terlihat, dan reload di tengah proses membuat tombol
tampak idle lagi.

## Tujuan

Meniru pola **live progress backfill** sehingga tiap kartu integrasi **berganti jadi
progress hero** selama resend berjalan: bar emerald, persen, jumlah in-flight, hitungan
status, ETA, **polling berhenti otomatis saat selesai**, dan **tahan reload** karena
state direkonstruksi dari `forwarding_logs` (persis cara `backfillProgress()` membaca
ulang `data_backfill_tasks`).

## Keputusan Desain (disetujui)

- **State persisten:** tambah kolom `resend_requested_at` (timestamp nullable) di
  `forwarding_logs`, di-stamp pada baris error **asli** saat job di-dispatch. Bukan tabel
  task penuh (cukup satu kolom; upgrade path = tabel task, out of scope). Snapshot
  React ditolak (hilang saat reload).
- **Polling 3 detik** (samakan dengan hook backfill).
- **ETA** = `pending × config('resend.interval', 2)` detik (job `default` ~instan).
- Invariant lama dijaga: job hanya menulis baris anak (`resend_of`); original tak diubah;
  throttle tak disentuh; hitung hanya baris asli (`resend_of IS NULL`); authz via
  `resolveLogger`; label Bahasa Indonesia; DB-agnostic (SQLite test + MySQL prod).

## Beda dari Backfill

Backfill punya tabel `data_backfill_tasks` dengan status `REQUESTED` dan worker
sekuensial (satu `current` menit). Resend fan-out N job paralel tanpa urutan → tidak ada
satu "current" item. Maka progress dimodelkan sebagai **jumlah in-flight** + `done/total`
per bucket. Tidak ada heatmap; tidak ada key `updates`.

## Payload `resendProgress(Logger, CarbonInterface): array`

Map **per integrasi**, key = `(string) integration->id` atau `'ministesy'`. Bucket hanya
muncul jika punya ≥1 baris error asli yang sudah pernah di-request (`resend_requested_at`
not null) dalam jendela hari. Kosong → `(object) []`.

Per-bucket:
```php
[
  'key'         => '<key>',                 // string
  'total'       => $total,                  // int — baris error asli yang di-request hari itu
  'done'        => $resolved + $failedAgain,// int
  'pct'         => (int) round($done / $total * 100), // int 0..100
  'counts'      => [
      'resolved'     => $resolved,          // ada anak status 'success'
      'failed_again' => $failedAgain,       // ada anak, tak ada yang 'success'
      'pending'      => $pending,           // di-request, belum ada anak (& belum stale)
  ],
  'current'     => $pending > 0 ? ['count' => $pending, 'oldest_seconds' => $oldest] : null,
  'eta_seconds' => $pending * (int) config('resend.interval', 2), // int
]
```

### Komputasi (semua dari `forwarding_logs`)

Baris asli yang di-request untuk bucket+hari:
```php
$rows = ForwardingLog::where('logger_id', $logger->id)
    ->where('status', 'error')
    ->whereNull('resend_of')
    ->whereNotNull('resend_requested_at')
    ->whereBetween('created_at', [$dayStart, $dayEnd])
    // bucket: ministesy → whereNull('integration_id')->where('target_name','Mini STESY')
    //         real      → where('integration_id', (int) $key)
    ->get(['id', 'resend_requested_at']);
```
`total = $rows->count()`.

Anak diambil satu query batch (hindari N+1), **tanpa** filter hari (anak dicocokkan murni
lewat `resend_of`, konsisten dgn `buildBucket`/`resendFailed`):
```php
$children = ForwardingLog::whereIn('resend_of', $rows->pluck('id'))
    ->get(['resend_of', 'status', 'id'])->groupBy('resend_of');
```

Klasifikasi tiap original:
- **resolved** — ada anak `status === 'success'` (success di mana pun menang; sama dengan
  logika resolved-skip di `resendFailed()`).
- **failed_again** — ada anak, tak ada yang success.
- **pending** — belum ada anak **dan** `resend_requested_at` belum melewati ambang stale.
- **Stale → failed_again:** kalau belum ada anak tapi `resend_requested_at` lebih tua dari
  `config('resend.stale_after', 300)` detik → klasifikasi `failed_again` (job ke-skip/guard,
  supaya hero bisa selesai & polling berhenti, tidak menggantung).

`oldest_seconds` = `abs(now()->diffInSeconds(min resend_requested_at dari baris pending))`.

## File

### Buat
- `database/migrations/2026_06_25_000001_add_resend_requested_at_to_forwarding_logs.php` —
  `timestamp('resend_requested_at')->nullable()->index()->after('resend_of')`. (`forwarding_logs`
  punya `$timestamps = false`; kolom dikelola manual.)
- `config/resend.php` — `['interval' => (int) env('RESEND_ETA_INTERVAL', 2), 'stale_after' => (int) env('RESEND_STALE_AFTER', 300)]`.
- `resources/js/hooks/use-resend-status.ts` — clone `use-backfill-status.ts`: signature
  `useResendStatus(loggerId, date, initial: ResendProgressMap): ResendProgressMap`; endpoint
  `GET /data-audit/${loggerId}/resend-status?date=`; **poll 3000ms**; auto-stop saat tidak ada
  bucket in-flight (`current !== null || counts.pending > 0`); cleanup unmount + saat
  `[loggerId,date]` berubah. Types `ResendBucketProgress` + `ResendProgressMap`.
- `resources/js/components/data-audit/resend-progress.tsx` — clone `backfill-progress.tsx`,
  satu hero per bucket. Props `{ progress: ResendBucketProgress; onRetry?: () => void; retrying?: boolean }`.
  Chips `resolved/failed_again/pending`; bar emerald; panel amber in-flight pakai
  `current.count` + ticker `oldest_seconds`; tombol retry (`variant=destructive`) hanya saat
  `!running && failed_again > 0 && onRetry`. Label Bahasa Indonesia (fallback `t(key,'...')`).

### Ubah
- `app/Models/ForwardingLog.php` — `$fillable` + `'resend_requested_at' => 'datetime'` di casts.
- `app/Services/ForwardingAuditService.php` — di `resendFailed()`, sebelum dispatch tiap row:
  `ForwardingLog::whereKey($id)->update(['resend_requested_at' => now()])` lalu dispatch
  (tetap return count). Tambah `resendProgress()` (reuse cabang bucket yang sama dgn
  `integrationAudit()`/`resendFailed()`).
- `app/Http/Controllers/DataAuditController.php` — `resendStatus(Request, int $id, ForwardingAuditService)`
  → `resolveLogger` + return `response()->json($forwarding->resendProgress(...))`. Di `show()`,
  tambah prop `'resendProgress' => $forwarding->resendProgress($logger, $date)`.
- `routes/web.php` — `GET data-audit/{id}/resend-status` name `data-audit.resend-status` di grup
  `['auth','verified']`.
- `resources/js/pages/data-audit/show.tsx` — `Props` + `resendProgress: ResendProgressMap`;
  `const resendProg = useResendStatus(logger.id, date, resendProgress)`; di `integrations.map`,
  jika `resendProg[it.key]` ada → render `<ResendProgress .../>` (ganti kartu statis), else
  kartu statis lama. `resendFailed(key)` tak berubah.

## Alur Data

1. Klik → POST `/resend`.
2. `resendFailed()`: untuk tiap error outstanding (bukan yg sudah resolved) →
   `update(['resend_requested_at'=>now()])` lalu `ResendForwarding::dispatch($id)`.
3. Reload/first paint: `show()` seed `resendProgress` → bucket punya baris pending → hero
   tampil (done 0/N, bar 0%, panel amber "N pengiriman ulang berjalan").
4. Poll tiap 3s: tiap job tulis anak → poll berikut reklasifikasi resolved/failed_again,
   pending turun, bar naik.
5. Selesai: `pending=0`, `current=null`, `done=total`, `pct=100`.
6. Auto-stop: poll yang melihat semua bucket tidak in-flight → `clearInterval`. Hero tetap
   tampil; jika `failed_again>0` muncul tombol "Kirim ulang lagi (M)".

## Edge Case

- **Re-click saat in-flight** → re-stamp hanya row tanpa anak success; job punya guard
  (skip jika sudah ada anak success). Aman.
- **Job ke-skip/guard** → stale threshold mengubah pending lama → failed_again (hero selesai).
- **`never_attempted`** → tak pernah punya baris asli → tak masuk resendProgress; kartu statis
  tetap menampilkan hint amber.
- **Anak beda hari** (audit hari lampau, resend lewat tengah malam) → query anak TIDAK
  di-filter hari (dicocokkan via `resend_of` saja). Aman.
- **Authz** → `resendStatus` pakai `resolveLogger` (non-superadmin → 404 utk logger bukan miliknya).
- **DB-agnostic** → `whereNotNull/whereBetween/whereIn`, update satu kolom, kolom `timestamp`
  nullable; `diffInSeconds` PHP-side. Tak ada raw SQL.

## Testing

PHPUnit/Pest (SQLite):
- `resendFailed()` men-stamp `resend_requested_at` pada row yang di-dispatch; row yg sudah
  resolved (punya anak success) tidak di-stamp & tidak di-dispatch (`Bus::fake`). Original
  `status`/`raw_payload` tak berubah.
- `resendProgress()` klasifikasi: success child→resolved; error child→failed_again;
  no child→pending. Assert `total/done/pct/counts/current/eta_seconds`.
- `resendProgress()` kosong → `(object) []` (lewat endpoint test).
- Bucket scoping ministesy vs real; hanya `resend_of IS NULL` dihitung.
- Stale pending (`resend_requested_at` > stale_after, no child) → failed_again.
- Endpoint `GET /resend-status`: 200 JSON map; authz non-owner → 404.
- `show()` seed prop `resendProgress`.

Frontend: `npm run types:check` bersih. (Verifikasi manual: worker Supervisor jalan,
klik resend, kartu→hero, angka jalan, polling berhenti di 100%, reload mid-flight re-render
hero dari seed server.)

## Out of Scope

- Tabel `ForwardingResendTask` lifecycle penuh (upgrade path).
- List per-row resend / `updates` map / heatmap forwarding.
- Mengubah status original / menggeser throttle.
- WebSocket/SSE push (tetap poll).
- Perubahan mobile (`mobile_cloud`).
- Retry/backoff `ResendForwarding` (`tries=1` tetap).
