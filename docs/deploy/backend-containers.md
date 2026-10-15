# Kontainerisasi Backend (SIM-26)

Backend = **dua proses, satu project `uv`**: token server (`api/server.py`, HTTP) dan
voice worker (`voice_worker/voice_agent.py`, outbound-only ke LiveKit). Dokumen ini
mengkontainerisasi keduanya untuk paritas lokal dan deploy GCP yang reproducible.

File yang di-commit (nyata, di `apps/backend/`):
- `Dockerfile` — multi-stage, dua target (`api`, `worker`) berbagi satu layer `uv sync`.
- `.dockerignore` — mengecualikan `.venv`, VCS, cache, dan **semua `.env*`** (kredensial).
- `docker-compose.yml` — layanan `api` + `worker` untuk paritas lokal.

## 1. Prasyarat
- Docker + Docker Compose (daemon jalan).
- `apps/backend/.env` terisi. Salin dari contoh: `cd apps/backend && cp .env.example .env`.
  Daftar & nilai: lihat [`production-config.md`](./production-config.md) §3.

## 2. Build & jalankan (lokal)

```bash
cd apps/backend
cp .env.example .env            # isi kredensial LiveKit + Azure + Supabase

docker compose config           # validasi YAML (tak butuh daemon)
docker compose up --build       # build kedua target + jalankan
```

Build target individual (tanpa compose):
```bash
docker build --target api    -t koperasi-api    apps/backend
docker build --target worker -t koperasi-worker apps/backend
```

## 3. Detail Dockerfile (kenapa begini)

- **Base `python:3.12-slim`** + salin biner `uv` dari `ghcr.io/astral-sh/uv:0.11.19`
  (di-pin — bukan `:latest`). Sesuaikan ke versi uv yang Anda uji.
- **Dua-layer caching**: `uv sync --frozen --no-install-project --no-dev` (deps saja,
  layer lambat & jarang berubah) lalu `COPY . /app` + `uv sync --locked --no-dev`
  (project, layer cepat). `--no-editable` wajib untuk multi-stage. Cache mount
  `--mount=type=cache,target=/root/.cache/uv` + `UV_LINK_MODE=copy`.
- **User non-root `app`** + `HF_HOME`/`XDG_CACHE_HOME` ke `/app/.cache` (writable untuk
  `download-files`).
- **Target `api`**: `CMD ["sh","-c","exec uvicorn api.server:app --host 0.0.0.0 --port ${PORT:-8000}"]`.
  ⚠️ `$PORT` penting — Cloud Run merutekan ke port container (default **8080**); `exec`
  agar SIGTERM mencapai uvicorn.
- **Target `worker`**: `download-files` mem-bake bobot VAD/turn-detector (openai/
  azure/silero); `start` = mode produksi (bukan `dev`), argv diteruskan lewat
  `cli.run_app(server)` (lihat `apps/backend/CLAUDE.md` GOTCHA #1: API `AgentServer`).
  Tak ada port *job* masuk (outbound), tapi framework mengekspos **health server di
  `:8081`** pada mode `start` (liveness proses) — `EXPOSE 8081` + `HEALTHCHECK`
  memakainya; di GCE dipakai MIG autohealing.

> ℹ️ **Versi `livekit-agents` di-pin `1.6.5`** di `uv.lock` (bukan 1.8.x — `~=1.6`
> dengan lock frozen tetap 1.6.5). Subcommand `start` & `download-files` serta API
> `AgentServer` cocok dengan 1.6.5. `download-files` butuh jaringan saat build dan
> mencetak peringatan *deprecated* (tetap jalan di 1.6.5); jika suatu saat gagal,
> hapus baris itu — model di-unduh otomatis saat sesi pertama (hanya lambat sekali).

## 4. Acceptance (SIM-26 "done when")

- [ ] `docker compose config` valid.
- [ ] `docker compose up --build` menjalankan **kedua** proses.
- [ ] `curl -fsS http://localhost:8000/health` → `{"status":"ok"}`.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/token -H 'Content-Type: application/json' -d '{"scenario_id":"kredit-macet"}'` → **401** *bila `.env` terisi* (`SUPABASE_JWKS_URL`+`SUPABASE_JWT_ISSUER` di-set → gerbang missing-bearer menyala). ⚠️ Pada container TANPA `.env` (JWKS belum di-set), responsnya **500** ("Konfigurasi verifikasi JWT belum lengkap") — itu wajar untuk keadaan belum-dikonfigurasi, bukan kegagalan.
- [ ] `docker compose logs worker` memuat baris `starting worker` + plugin registered; `curl http://localhost:8081/` → 200 (liveness framework). Registrasi job ke LiveKit butuh kredensial LiveKit nyata.
- [ ] Paritas `LIVEKIT_AGENT_NAME` antar proses:
  ```bash
  docker compose exec api    printenv LIVEKIT_AGENT_NAME
  docker compose exec worker printenv LIVEKIT_AGENT_NAME   # HARUS identik
  ```
- [ ] Image bersih dari secret: `docker run --rm koperasi-api sh -c 'ls -a /app | grep -i env || echo none'` → `none`.

> ✅ **Terverifikasi (2026-10-15):** kedua target di-build; `docker compose up`
> menjalankan api + worker; `/health` 200; unauth `/token` 401 (dengan `.env` terisi
> dummy); worker `:8081` liveness 200 + `starting worker`; paritas `LIVEKIT_AGENT_NAME`;
> image api bebas file `.env`; berjalan sebagai user non-root `app`. Yang **belum**
> diverifikasi (butuh kredensial nyata): registrasi job LiveKit + jalur voice E2E —
> jalankan dengan `.env` produksi sebelum menandai SIM-26 tuntas sepenuhnya.

## Referensi
- `apps/backend/CLAUDE.md` (dua proses, GOTCHAS), `apps/backend/pyproject.toml` (Python 3.12, uv).
- uv Docker: https://docs.astral.sh/uv/guides/integration/docker/
- LiveKit agents deploy/builds: https://docs.livekit.io/deploy/agents/builds/
- Lanjut: [`gcp-backend.md`](./gcp-backend.md) untuk push image + deploy.
