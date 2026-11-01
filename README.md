# AXEZEN Downloader API

Backend Node.js untuk AXEZEN HTML.

## Jalankan lokal
1. Install Node.js 20+.
2. Buka folder ini di terminal.
3. Jalankan `npm install`.
4. Salin `.env.example` menjadi `.env`, lalu isi konfigurasi jika ada provider API.
5. Jalankan `npm start`.
6. Buka `http://localhost:3000/api/health`.

## Endpoint
- `GET /api/health`
- `POST /api/download` dengan JSON `{ "url": "https://...", "platform": "auto|drive|direct|tiktok|instagram|youtube|facebook|x" }`
- `GET /api/file?url=<encoded-public-url>`

Direct URL dan tautan berbagi Google Drive publik diproses lewat server sehingga tidak bergantung pada CORS browser. Google Drive dapat meminta login/konfirmasi untuk file tertentu; file privat tidak dapat diakses tanpa autentikasi resmi.

## Platform sosial
Backend ini sengaja TIDAK mengunduh konten sosial dengan scraping atau membypass login, DRM, paywall, atau proteksi. Untuk TikTok/Instagram/Facebook/X, konfigurasi provider API yang sah melalui `AXEZEN_SOCIAL_API_URL`. YouTube audiovisual tidak boleh diunduh melalui YouTube API tanpa izin tertulis; gunakan hanya integrasi berizin dan konten yang memang boleh diunduh. Token provider hanya disimpan di server, jangan di HTML.

## Deploy
Deploy ke server HTTPS yang kamu kendalikan. Sajikan file AXEZEN HTML dari origin yang sama atau atur reverse proxy `/api` ke backend. Jangan membuka endpoint ini ke publik tanpa rate limit, autentikasi, kuota, dan monitoring.
