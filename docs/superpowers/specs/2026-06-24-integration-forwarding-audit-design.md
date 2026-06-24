# Audit Integrasi / Forwarding + Kirim Ulang

**Tanggal:** 2026-06-24
**Status:** Disetujui (siap rencana implementasi)

## Latar Belakang & Masalah

Sistem sudah punya **audit ingestion**: per logger per hari menghitung menit yang diharapkan
(1440) vs menit yang masuk (`SensorLog`) vs hilang, dan bisa backfill dari logger
(`DataAuditService`, `LoggerDailyAudit`, halaman `data-audit`).

Tetapi **forwarding ke platform lain belum diaudit**. Pada setiap data masuk,
`App\Jobs\ForwardToIntegrations` meneruskan `raw_payload` ke tiap `LoggerIntegration`
yang aktif (plus Mini STESY) bila throttle `interval_minutes` sudah due, dan mencatat
tiap percobaan ke `forwarding_logs` dengan status `success` / `error` / `skipped`
beserta `raw_payload` lengkap.

Konsekuensinya jumlah data dari logger bisa berbeda dengan jumlah yang berhasil
diteruskan ke tiap platform, dan tidak ada cara untuk merekonsiliasi maupun mengirim
ulang yang gagal. Dua sumber selisih utama:

1. **Gagal (`error`)** — platform menolak / timeout saat forwarding.
2. **Belum pernah dicoba** — menit hasil **backfill** ditulis langsung ke `SensorLog`
   tanpa pernah memicu forwarding, jadi tidak ada baris `forwarding_logs` sama sekali.

## Tujuan

Tambahkan **audit integrasi** ke menu Data Audit: rekonsiliasi jumlah data dari logger
vs jumlah yang berhasil diteruskan ke tiap platform (sadar-interval), plus tombol
**kirim ulang** untuk yang gagal.

## Keputusan Desain (hasil brainstorming)

- **Sumber kirim ulang:** replay `raw_payload` yang tersimpan di `forwarding_logs`
  (byte-exact, sederhana). Konsekuensi: hanya ember **Gagal** yang bisa ditambal;
  ember **Belum-pernah-dicoba** tidak punya baris log sehingga hanya ditampilkan
  sebagai peringatan.
- **Basis "harus diteruskan":** rekonsiliasi penuh vs ingested, sadar-interval.
- **Pemicu:** tombol manual per integrasi (konsisten dgn backfill + retry-failed).
- **Scope v1:** hidup di halaman detail audit (`data-audit/show`), dihitung live
  (pola sama seperti `backfillProgress`). Halaman index dibiarkan ingestion-only;
  badge forwarding di index = follow-up opsional.

## Rekonsiliasi (per logger / per integrasi / per tanggal)

Untuk tiap `LoggerIntegration` aktif **+ Mini STESY** (bila aktif di logger):

| Ember | Sumber | Arti |
|---|---|---|
| **Dari logger** | `present minutes` (SensorLog) | jumlah menit data masuk |
| **Harus diteruskan** | simulasi throttle `interval_minutes` atas present minutes | interval 1 → = jumlah menit; interval N → ± menit/N |
| **Terkirim OK** | `success` asli + `error` yang sudah teratasi resend | berhasil sampai platform |
| **Gagal (outstanding)** | `error` tanpa anak resend sukses | target tombol resend |
| **Di-skip (interval)** | `skipped` | normal saat interval > 1, bukan kesalahan |
| **Belum pernah dicoba** | `harus diteruskan − (success + error)` | data ada tapi forwarding tak pernah jalan (biasanya backfill) — hanya ditampilkan |

Kalau interval 1 menit dan tanpa gap backfill, idealnya **Dari logger = Terkirim OK**.

### Simulasi "harus diteruskan" (sadar-interval)

Greedy atas present minutes terurut, meniru `LoggerIntegration::isDueForForwarding`:
ambil menit present pertama sebagai due, lalu due berikutnya = menit present pertama
yang `>= last_due + interval_minutes`. Hitung jumlah due. Untuk interval = 1 menit hasil
= jumlah present minutes. Mini STESY pakai `ministesy_interval` (default 10).

### Penghitungan dari `forwarding_logs`

Hanya baris **asli** (`resend_of IS NULL`) per (logger, integration, tanggal):
- `success_count` = status `success`
- `skipped_count` = status `skipped`
- baris `error` dipisah: **teratasi** (punya anak `resend_of = id` ber-status `success`)
  vs **outstanding** (tidak punya).

Maka:
- Terkirim OK = `success_count + error_teratasi`
- Gagal (outstanding) = `error_outstanding`  ← target resend
- Belum pernah dicoba = `due − (success_count + total_error)` (minimal 0)

Mini STESY diidentifikasi dengan `integration_id IS NULL AND target_name = 'Mini STESY'`.

Asumsi: 1 baris forwarding per push per integrasi (job mencatat tepat satu per
integrasi tiap push). Push ganda di menit sama = edge case yang diterima sebagai
aproksimasi.

## Mekanisme Kirim Ulang

1. User klik **"Kirim ulang N gagal"** untuk integrasi X, tanggal D → Inertia POST
   ke action `resendForwarding`.
2. Service `resendFailed(logger, integrationKey, date)` mengambil baris `error`
   outstanding untuk (logger, integration, tanggal), lalu dispatch `ResendForwarding`
   per baris. Mengembalikan jumlah yang di-enqueue.
3. Job `ResendForwarding` (tries = 1) menerima id baris error asal, lalu re-POST
   `raw_payload` ke endpoint integrasi (atau Mini STESY) memakai header auth yang sama,
   dan mencatat **baris `forwarding_logs` baru** dengan `resend_of = id_asal`,
   status `success` / `error`.
4. Resend **tidak menyentuh** throttle (`last_forwarded_data_at` /
   `ministesy_last_forwarded_data_at`) — murni menambal lubang agar tak memicu skip
   data berikutnya.

## Komponen

1. **Migration** `add_resend_of_to_forwarding_logs`: kolom `resend_of`
   (nullable unsignedBigInteger, index). Tidak perlu FK keras (cukup index).
2. **Model** `ForwardingLog`: tambah `resend_of` ke `$fillable`; relasi opsional
   `resendOf()` / `resends()`.
3. **Service baru** `App\Services\ForwardingAuditService`:
   - `integrationAudit(Logger $logger, CarbonInterface $date): array` — daftar
     ember per integrasi (+ Mini STESY), dihitung live.
   - `dueForwards(...)` helper simulasi interval.
   - `resendFailed(Logger $logger, string $integrationKey, CarbonInterface $date): int`
     — dispatch job resend; `integrationKey` = id integrasi atau token `ministesy`.
   Dipisah dari `DataAuditService` agar tiap service fokus.
4. **Job baru** `App\Jobs\ResendForwarding`: replay satu baris error → catat baris
   `resend_of`. Logika POST dynamic-integration mengikuti `ForwardToIntegrations::forwardTo`;
   Mini STESY mengikuti `forwardMiniStesy` (tanpa update throttle).
5. **Controller** `DataAuditController`:
   - `show()` menambah `integrations` => `ForwardingAuditService::integrationAudit(...)`.
   - action baru `resendForwarding(Request, int $id)` (validasi `date` + `integration`),
     panggil `resendFailed`, `back()->with('status', ...)`.
6. **Route** `web.php`: `POST data-audit/{id}/resend` → `data-audit.resend`.
7. **Frontend** `resources/js/pages/data-audit/show.tsx`: section
   **"Integrasi & Forwarding"** — kartu per platform berisi angka rekonsiliasi +
   tombol "Kirim ulang N gagal" (Inertia POST). Label Bahasa Indonesia. Ember
   "Belum pernah dicoba" tampil sebagai peringatan halus dengan hint backfill.
8. Regenerasi route/action TS (Wayfinder) untuk action baru.

## Penanganan Error / Edge Case

- Integrasi nonaktif/terhapus: audit hanya menampilkan integrasi aktif + Mini STESY;
  baris log lama dari integrasi terhapus diabaikan di v1.
- Endpoint mati saat resend: baris `resend_of` ber-status `error`; outstanding tetap,
  user bisa klik lagi.
- Idempotensi: resend yang sukses menambah baris sukses ber-`resend_of`; klik ulang
  hanya menarget error yang masih outstanding (sudah ter-resolve tidak dikirim ulang).
- `raw_payload` null pada baris error lama (sebelum kolom ada): lewati + catat skip.

## Testing

Feature test PHPUnit (TDD):
- `integrationAudit`: ember benar untuk interval 1 (Dari logger = Harus diteruskan)
  dan interval 10 (Harus diteruskan ≈ menit/10); kasus ada `error`, `skipped`, dan
  menit "belum pernah dicoba".
- `resendFailed`: `Http::fake()` sukses → baris `resend_of` sukses dibuat, outstanding
  berkurang; `Http::fake()` gagal → baris `resend_of` error, outstanding tetap.
- Resend tidak mengubah `last_forwarded_data_at`.

## Di Luar Scope (v1)

- Menambal otomatis ember "Belum pernah dicoba" (butuh rebuild dari SensorLog).
- Auto-resend pada tiap scan.
- Badge/kolom forwarding di halaman index audit.
- Persistensi audit integrasi ke tabel (dihitung live dulu).
