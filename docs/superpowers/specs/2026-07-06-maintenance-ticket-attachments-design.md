# Maintenance Ticket Attachments Design

**Goal:** Perluas dialog Buat Tiket Maintenance agar operator/teknisi bisa mencatat tanggal pelaksanaan, beberapa kendala, beberapa perbaikan, laporan PDF, dan foto dokumentasi.

**Chosen UI:** Tetap memakai dialog dari halaman Maintenance, tetapi diperbesar agar mengikuti referensi yang dipilih pengguna.

**Data model:** Tambah kolom nullable pada `maintenance_tickets`: `performed_at`, `issues`, `repairs`, `report_path`, dan `documentation_photos`. `issues` dan `repairs` disimpan sebagai JSON array string. File disimpan di disk `public` dalam folder `maintenance/reports` dan `maintenance/photos`.

**Compatibility:** Field lama tetap dipakai. Saat create dari form baru, `issue_title` diisi dari kendala pertama, `issue_description` dari gabungan semua kendala, dan `repair_action` dari gabungan semua perbaikan agar daftar tiket/detail lama tetap bisa membaca ringkasan tiket.

**Validation:** `performed_at`, minimal satu `issues`, dan minimal satu `repairs` wajib. PDF bersifat opsional, hanya `pdf`, maksimal 10 MB. Foto opsional, boleh banyak, hanya gambar `jpg/jpeg/png/webp`, maksimal 5 MB per file.

**Detail view:** Halaman detail menampilkan tanggal pelaksanaan, daftar kendala, daftar perbaikan, link laporan PDF, dan daftar foto dokumentasi jika tersedia.
