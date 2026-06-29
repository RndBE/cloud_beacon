# Modbus Data Type Codes — Referensi Integrator Software

Dokumen acuan untuk integrator yang mengonfigurasi sensor Modbus RTU pada BEACON
Logger lewat protokol `SENSORS` (RS485). Menjelaskan **KODE TIPE DATA** — satu
angka yang mengkodekan **tipe data sekaligus urutan byte/word** sensor.

> Sumber kebenaran di firmware: `MB_TYPE_TABLE` di
> [`Core/Src/Request.c`](../Core/Src/Request.c). Jika tabel di bawah berbeda
> dengan kode, **kode yang benar**.

---

## 1. Letak kode di protokol

Konfigurasi tiap sensor RS485 dikirim sebagai array **6 elemen**:

```
s = [ sensor_type, scale, unit, register_address, reg_count, fast_poll ]
                                                   ^^^^^^^^^
                                                   KODE TIPE DATA (1..27)
```

| Index | Field | Keterangan |
|---:|---|---|
| 0 | `sensor_type` | Nama sensor (string, ≤12 char) |
| 1 | `scale` | Pengali; `nilai = raw × scale + offset` |
| 2 | `unit` | Satuan (string) |
| 3 | `register_address` | Alamat register awal (Modbus) |
| 4 | **`reg_count`** | **KODE TIPE DATA (1..27)** — lihat tabel §3 |
| 5 | `fast_poll` | `0` = poll 1 menit, `1` = poll 1 detik |

> Nama field tetap `reg_count` demi kompatibilitas layout flash, tetapi **isinya
> adalah kode tipe data**, bukan sekadar jumlah register. Jumlah register dihitung
> otomatis oleh firmware dari kode.

---

## 2. Konvensi urutan byte/word

Untuk nilai yang menempati lebih dari 1 register (32/64-bit), urutan byte penting.
Misal nilai 4 byte `A B C D` (A = byte paling signifikan):

| Nama (UI) | Pola | Arti |
|---|---|---|
| **Big-endian** | `ABCD` | Normal (register pertama = word tinggi, byte tinggi dulu) |
| **Little-endian** | `DCBA` | Urutan terbalik penuh |
| **Big-endian byte swap** | `BADC` | Byte dalam tiap register ditukar; urutan word tetap |
| **Little-endian byte swap** | `CDAB` | Urutan word ditukar; byte dalam register tetap |

Jika hasil pembacaan jadi angka sangat besar/kecil/tidak masuk akal, biasanya
urutan byte salah → coba varian lain dari tipe yang sama.

---

## 3. Tabel KODE TIPE DATA (lengkap)

> ⚠️ Kode **1, 2, 4 dibekukan** demi config logger yang sudah terpasang di
> lapangan — jangan pernah diubah artinya. Kode `3` dan `5..27` adalah penataan
> baru. Logger lapangan umumnya hanya memakai `1`, `2`, `4`.

| Kode | Tipe | Reg | Urutan byte | Signed | Catatan |
|---:|---|:--:|---|:--:|---|
| 1 | UINT16 | 1 | — | – | 🔒 legacy (= U16) |
| 2 | FLOAT32 | 2 | Big-endian | – | 🔒 legacy (= FLOAT32 BE) |
| 3 | INT16 | 1 | — | ✔ | |
| 4 | U32 bulat.pecahan | 4 | Big-endian | – | 🔒 dikunci; `nilai = bulat + pecahan/1e9` |
| 5 | UINT32 | 2 | Big-endian | – | |
| 6 | UINT32 | 2 | Little-endian | – | |
| 7 | UINT32 | 2 | Big-endian byte swap | – | |
| 8 | UINT32 | 2 | Little-endian byte swap | – | |
| 9 | INT32 / LONG | 2 | Big-endian | ✔ | |
| 10 | INT32 / LONG | 2 | Little-endian | ✔ | |
| 11 | INT32 / LONG | 2 | Big-endian byte swap | ✔ | |
| 12 | INT32 / LONG | 2 | Little-endian byte swap | ✔ | |
| 13 | FLOAT32 | 2 | Little-endian | – | Big-endian = **kode 2** |
| 14 | FLOAT32 | 2 | Big-endian byte swap | – | |
| 15 | FLOAT32 | 2 | Little-endian byte swap | – | |
| 16 | UINT64 | 4 | Big-endian | – | |
| 17 | UINT64 | 4 | Little-endian | – | |
| 18 | UINT64 | 4 | Big-endian byte swap | – | |
| 19 | UINT64 | 4 | Little-endian byte swap | – | |
| 20 | INT64 | 4 | Big-endian | ✔ | |
| 21 | INT64 | 4 | Little-endian | ✔ | |
| 22 | INT64 | 4 | Big-endian byte swap | ✔ | |
| 23 | INT64 | 4 | Little-endian byte swap | ✔ | |
| 24 | FLOAT64 / DOUBLE | 4 | Big-endian | – | |
| 25 | FLOAT64 / DOUBLE | 4 | Little-endian | – | |
| 26 | FLOAT64 / DOUBLE | 4 | Big-endian byte swap | – | |
| 27 | FLOAT64 / DOUBLE | 4 | Little-endian byte swap | – | |

**Pola hafalan** untuk tiap tipe ≥2 register (4 varian berurutan):
`Big-endian → Little-endian → Big-endian byte swap → Little-endian byte swap`.
(Pengecualian: FLOAT32 Big-endian memakai kode 2, jadi blok FLOAT32 baru mulai
dari Little-endian = kode 13.)

---

## 4. Pemilihan cepat (16/32/64-bit signed)

| Butuh | Kode |
|---|---|
| Unsigned 16-bit | `1` atau `5`*… (gunakan `1`) |
| **Signed 16-bit** | `3` |
| Unsigned 32-bit, big-endian | `5` |
| **Signed 32-bit, big-endian** | `9` |
| **Signed 32-bit, little-endian** | `10` |
| Float 32-bit, big-endian | `2` |
| Float 32-bit, little-endian | `13` |
| Unsigned 64-bit, big-endian | `16` |
| **Signed 64-bit, big-endian** | `20` |
| **Signed 64-bit, little-endian** | `21` |
| Float 64-bit, big-endian | `24` |

> *UINT16 tidak diberi slot baru — pakai kode `1`.

---

## 5. Contoh konfigurasi

**Flowrate FLOAT32 big-endian (register 0x0001–0x0002):**
```json
["Flowrate", 1, "m3/h", 1, 2, 0]
```

**Totalizer INT32 signed little-endian (register 10):**
```json
["Total", 0.01, "m3", 10, 10, 0]
```

**Level INT16 signed (register 5, poll 1 detik):**
```json
["Level", 0.1, "m", 5, 3, 1]
```

**Energy UINT64 big-endian (register 20–23):**
```json
["Energy", 1, "kWh", 20, 16, 0]
```

Saat membaca konfigurasi kembali (`GET`), firmware mengembalikan kode yang sama
di index ke-4.

---

## 6. Kompatibilitas & batasan

- **Backward-compatible:** config lama yang memakai kode `1`/`2`/`4` tetap bekerja
  identik. Tidak ada perubahan struktur flash maupun jumlah elemen protokol.
- **Validasi:** kode di luar `1..27` ditolak firmware dan di-default ke `1`
  (UINT16). Berlaku saat `SET`, saat `GET`, dan saat memuat dari flash (boot).
- **Presisi:** nilai sensor disimpan internal sebagai `float` (mantissa efektif
  24-bit ≈ 7 digit signifikan). Maka UINT32/INT32 di atas ~16,7 juta, seluruh
  UINT64/INT64, dan FLOAT64 akan **kehilangan sebagian presisi**. Untuk totalizer
  besar, gunakan `scale` agar nilai tetap dalam rentang presisi float.
- **Mode 4 (U32 bulat.pecahan):** selalu big-endian, tidak punya varian endian,
  dan tidak boleh dipakai untuk tujuan lain.

---

## 7. Verifikasi (untuk QA)

Contoh FLOAT32 nilai `55.2` = IEEE-754 `0x425CCCCD`, byte `42 5C CC CD`:

| Kode | Urutan | Register di kabel | Hasil |
|---:|---|---|:--:|
| 2 | Big-endian | `425C CCCD` | 55.2 |
| 13 | Little-endian | `CDCC 5C42` | 55.2 |
| 14 | Big-endian byte swap | `5C42 CDCC` | 55.2 |
| 15 | Little-endian byte swap | `CCCD 425C` | 55.2 |

Keempatnya harus menghasilkan **55.2** — hanya berbeda bagaimana sensor menaruh
byte di kabel.

---

*Implementasi: `MB_TYPE_TABLE`, `Modbus_ReorderRegs`, `Modbus_AssembleRaw`,
`Modbus_NormalizeRegCount` di [`Core/Src/Request.c`](../Core/Src/Request.c).
Kontrak tes: [`tests/test_u32_intfrac_mode.py`](../tests/test_u32_intfrac_mode.py).*
