# Corrotrans Vehicle Display Tablet

PWA tablet mandiri berbasis React dan Vite. Dalam mode standby tablet menampilkan QR sekali pakai; setelah Driver resmi memindainya dari aplikasi Driver, halaman menampilkan profil Driver dan kendaraan yang ditetapkan Admin, lalu menerima perubahan perjalanan melalui server-sent events.

## Jalankan lokal

1. Gunakan Node.js 22+ dan pnpm 10+.
2. Jalankan `pnpm install` lalu `pnpm dev`.
3. Default API adalah origin yang sama dengan PWA. Salin `.env.example` menjadi `.env.local` hanya bila perlu mengarahkan browser ke origin API yang berbeda, lalu isi `VITE_API_BASE_URL` dengan origin API tanpa akhiran `/api`.
4. Untuk production jalankan `pnpm build`; hasil ada di `dist/`.

## Koneksi dan batas keamanan

- Browser hanya memanggil API Corrotrans. Tidak ada Supabase service-role key, anon key, maupun akses Supabase langsung di PWA.
- Pilihan deployment yang disarankan adalah menyajikan PWA dan `/api` pada origin yang sama. Jika API terpisah, konfigurasi allowlist CORS API dengan origin PWA yang tepat sebelum mengisi `VITE_API_BASE_URL`.
- QR memuat kode pairing berumur pendek dan sekali pakai. Token sesi tablet hanya digunakan sebagai Bearer untuk API; jangan menaruhnya di query string, log, atau analitik.
- Profil nyata dan status perjalanan memerlukan API server Corrotrans dan migrasi database companion di bagian `backend/` dan `supabase/migrations/`.
- `packages/corrotrans-design-system` adalah snapshot komponen dan token dari design system Corrotrans agar repo ini dapat dibangun terpisah. Sumber aslinya ada di monorepo Corrotrans.

## PWA tablet

`public/manifest.json` mengatur `display: standalone` dan `orientation: landscape`. Dari Chrome di Android, buka origin HTTPS lalu pilih Install app / Add to Home screen. Browser/OS dapat mengabaikan penguncian orientasi; atur tablet ke landscape bila perangkat tidak mengunci otomatis.

## Companion backend

Perubahan database dan API yang diperlukan ada di `supabase/migrations/0035_vehicle_display_driver_profile.sql` dan `backend/vehicle-display-route.ts`. File route adalah sumber companion untuk route API Corrotrans, bukan server mandiri. Ikuti `backend/README.md` untuk memasangnya. Migrasi hanya menyiapkan source; file ini tidak menerapkan migrasi ke staging atau production.
