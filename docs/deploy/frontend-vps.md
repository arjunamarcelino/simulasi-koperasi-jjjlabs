# Deploy Frontend di VPS In-House (nginx + TLS) — SIM-25

Build dua SPA (`apps/web` → `app.<domain>`, `apps/admin` → `admin.<domain>`) dan sajikan
dari VPS Ubuntu/Debian via nginx + TLS Let's Encrypt. Backend (`api.<domain>`) di GCP —
lihat [`gcp-backend.md`](./gcp-backend.md); env/origin: [`production-config.md`](./production-config.md).

> ⚠️ **Urutan:** `api.<domain>` harus sudah diputuskan & live **sebelum** build FE —
> URL backend + CSP di-bake saat build (lihat §2). Mengubahnya nanti = rebuild.

## 1. Prasyarat
- VPS Ubuntu/Debian, akses sudo, IP publik.
- DNS `app.<domain>` & `admin.<domain>` → IP VPS (lihat `production-config.md` §2).
- Node ≥ 22 + `pnpm` (sesuai CI: `pnpm/action-setup@v4`, Node 22). `corepack enable`.
- nginx: `sudo apt update && sudo apt install -y nginx`.

## 2. Build (di VPS atau CI, lalu salin `dist/`)

Set env **produksi** per app sebelum build. Blok di bawah adalah **template salin-tempel**;
daftar var + nilai otoritatif ada di [`production-config.md`](./production-config.md) §3a/§3b
(sumber kebenaran — jika menambah/mengubah var `VITE_*`, ubah §3 juga). Var `VITE_*`
di-inline saat build; backend URL + CSP `connect-src` dibekukan ke HTML.

```bash
# game
cat > apps/web/.env.production <<'EOF'
VITE_TRANSPORT=livekit
VITE_TOKEN_ENDPOINT=https://api.<domain>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_TURNSTILE_SITE_KEY=<turnstile-site-key>
EOF
# admin  (⚠️ pakai VITE_ADMIN_API_ENDPOINT, BUKAN VITE_TOKEN_ENDPOINT)
cat > apps/admin/.env.production <<'EOF'
VITE_ADMIN_API_ENDPOINT=https://api.<domain>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_TURNSTILE_SITE_KEY=<turnstile-site-key>
EOF

pnpm install --frozen-lockfile
pnpm --filter web build          # → apps/web/dist/
pnpm --filter admin build        # → apps/admin/dist/
```

> ⚠️ **Gate build (cegah "build sukses tapi app mati"):** input CSP di-if-guard — var
> hilang/typo tetap build sukses tapi origin API senyap hilang dari CSP → `/token`
> diblok saat runtime (hanya error CSP di console). Verifikasi:
> ```bash
> grep -o 'connect-src[^"]*' apps/web/dist/index.html    # harus memuat https://api.<domain>
> grep -o 'connect-src[^"]*' apps/admin/dist/index.html  # idem
> ```
> **Jangan** pakai `vite preview` sebagai server produksi (bukan untuk itu — docs resmi).

## 3. Rilis atomic (symlink)

Deploy ke direktori rilis ber-timestamp + symlink `current` — swap atomic, rollback instan.
```bash
sudo mkdir -p /var/www/app/releases /var/www/admin/releases
TS=$(date +%Y%m%d%H%M%S)
sudo cp -r apps/web/dist   /var/www/app/releases/$TS
sudo cp -r apps/admin/dist /var/www/admin/releases/$TS
sudo ln -sfn /var/www/app/releases/$TS   /var/www/app/current
sudo ln -sfn /var/www/admin/releases/$TS /var/www/admin/current
```
Rollback = arahkan ulang symlink ke rilis sebelumnya + `nginx -t && systemctl reload nginx`
(jangan rebuild — rebuild mem-bake ulang CSP).

## 4. nginx

Header keamanan dipisah ke snippet agar bisa di-`include` di tiap `location`.
`/etc/nginx/snippets/security-headers.conf`:
```nginx
add_header Strict-Transport-Security "max-age=300" always;  # ⚠️ nilai BRING-UP kecil; lihat catatan
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(self), geolocation=(), payment=()" always;
add_header X-Frame-Options "DENY" always;   # meta-CSP tak bisa bawa frame-ancestors → anti-clickjacking di sini
```
> ⚠️ **HSTS dinaikkan bertahap.** Mulai `max-age=300` saat bring-up; setelah yakin TLS
> stabil, naikkan ke `max-age=31536000` (1 tahun). `includeSubDomains` di `app.<domain>`
> hanya mencakup `*.app.<domain>` (bukan host saudara `admin.`/`api.` — header di-serve
> per-host), jadi tambahkan di tiap host yang perlu; untuk mencakup semua subdomain, set
> HSTS di apex. `preload` bersifat **~ireversibel** — tambahkan hanya bila setiap subdomain
> permanen HTTPS. Mic = `microphone=(self)` (app butuh mic voice).

`/etc/nginx/sites-available/app.<domain>`:
```nginx
server {
  listen 443 ssl; http2 on;
  server_name app.<domain>;
  server_tokens off;
  root /var/www/app/current; index index.html;

  # ⚠️ Jebakan nginx: location dgn add_header sendiri TIDAK mewarisi add_header server.
  #    Maka security-headers di-include ULANG di tiap location yang punya add_header.
  include snippets/security-headers.conf;

  location / {
    try_files $uri $uri/ /index.html;
    include snippets/security-headers.conf;
  }
  location /assets/ {
    try_files $uri =404;                         # jangan fallback ke index.html untuk aset hashed
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    include snippets/security-headers.conf;
  }
  location = /index.html {
    add_header Cache-Control "no-cache" always;  # selalu revalidate → ambil hash aset baru
    include snippets/security-headers.conf;
  }

  gzip on; gzip_vary on; gzip_comp_level 6; gzip_min_length 1024;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml application/wasm;

  # ⚠️ JANGAN tambah header Content-Security-Policy di nginx — app mengirim meta-CSP
  #    saat build; CSP kedua ber-INTERSEKSI dan mematahkan app.
  ssl_protocols TLSv1.2 TLSv1.3;                 # Mozilla Intermediate
  ssl_prefer_server_ciphers off;
  # ssl_stapling DIHAPUS — OCSP Let's Encrypt dimatikan 2025 (no-op).
}
```
Duplikasi untuk `admin.<domain>` (root `/var/www/admin/current`). Lalu blok `:80` →
301 ke `:443` yang menjaga `/.well-known/acme-challenge/` tetap terjangkau:
```nginx
server {
  listen 80; listen [::]:80;
  server_name app.<domain> admin.<domain>;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://$host$request_uri; }
}
```
Aktifkan: `sudo ln -s /etc/nginx/sites-available/app.<domain> /etc/nginx/sites-enabled/`
(idem admin), `sudo nginx -t && sudo systemctl reload nginx`.

## 5. TLS (certbot, per-host)

```bash
sudo snap install core; sudo snap refresh core
sudo apt-get remove -y certbot 2>/dev/null || true     # jangan campur apt + snap
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot

sudo certbot --nginx -d app.<domain>
sudo certbot --nginx -d admin.<domain>

# auto-renew (LE hentikan email kedaluwarsa 2025 → self-monitor)
systemctl list-timers 'certbot*' 'snap.certbot*'
sudo certbot renew --dry-run
sudo certbot renew --deploy-hook "systemctl reload nginx"
```

## 6. Hardening host (VPS internet-facing)

```bash
sudo ufw default deny incoming; sudo ufw default allow outgoing
sudo ufw allow 22,80,443/tcp && sudo ufw enable
# SSH key-only:
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/;s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
# patch rutin; opsional: sudo apt install -y fail2ban
```

## 7. Acceptance (SIM-25 "done when")
- [ ] Kedua SPA tersaji via TLS dari nol (`https://app.<domain>`, `https://admin.<domain>`).
- [ ] `connect-src` di kedua `dist/index.html` memuat `https://api.<domain>`.
- [ ] Tepat satu CSP (meta) terkirim: `curl -sI https://app.<domain> | grep -i content-security-policy` → kosong (tak ada header CSP); `curl -s https://app.<domain> | grep -c 'http-equiv="Content-Security-Policy"'` → `1`.
- [ ] Header keamanan ADA di dokumen HTML: `curl -I https://app.<domain>/index.html | grep -i strict-transport` (membuktikan re-include bekerja).
- [ ] Deep-link 200: `curl -s -o /dev/null -w '%{http_code}\n' https://app.<domain>/x/y` → 200 (try_files).
- [ ] `certbot renew --dry-run` lulus; ufw aktif; SSH key-only.
- [ ] E2E: login guest → voice jalan; login admin → dashboard tampil (lihat `README.md`).

## Referensi
- certbot/nginx: https://certbot.eff.org/instructions?ws=nginx&os=snap · TLS: https://ssl-config.mozilla.org/
- Vite build/base/env: https://v7.vite.dev/guide/build · /guide/static-deploy · /guide/env-and-mode
- CSP multi-policy: https://csper.io/blog/multiple-policies · cache: https://web.dev/articles/http-cache
