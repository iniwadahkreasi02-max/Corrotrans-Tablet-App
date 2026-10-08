# Companion API dan database

PWA ini membutuhkan kontrak berikut dari API server Corrotrans:
- `POST /api/vehicle-display/pairing-requests` untuk membuat QR dan capability token tablet.
- `GET /api/vehicle-display/pairing-requests/:requestId` untuk status pairing.
- `GET /api/vehicle-display/session` dan `GET /api/vehicle-display/events` untuk sesi tervalidasi dan pembaruan real-time.
- `POST /api/vehicle-display/unpair` untuk mencabut sesi.

`vehicle-display-route.ts` memuat route companion yang telah diubah untuk mengambil profil Driver melalui RPC server-side yang dibatasi hash token sesi. Gabungkan perubahan ini ke route yang sudah ada pada API Corrotrans; jangan menjalankan file ini sebagai route server terpisah. API tetap memakai environment/secret staging atau production milik server yang sesuai. Jangan masukkan credential ke repository publik atau bundle browser.

Migrasi `0035_vehicle_display_driver_profile.sql` menambahkan RPC profil terbatas dan pemicu realtime untuk perubahan nama/foto Driver. Terapkan hanya setelah tinjauan dan persetujuan terpisah pada environment yang dituju; migrasi tidak otomatis dijalankan oleh build/deploy PWA.
