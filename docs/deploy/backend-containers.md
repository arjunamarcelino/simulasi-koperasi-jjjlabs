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
- **Target `worker`**: `download-files` mem-bake bobot VAD/turn-detector; `start` =
  mode produksi (bukan `dev`), argv diteruskan lewat `cli.run_app(server)`
  (lihat `apps/backend/CLAUDE.md` GOTCHA #1: API `AgentServer`). Outbound-only →
  **tanpa `EXPOSE`/port masuk**.

> ⚠️ **`download-files`**: butuh jaringan saat build dan subcommand harus ada di versi
> `livekit-agents` terpasang (`~=1.6` saat ini resolve ke 1.8.x). Jika build gagal di
> baris ini, hapus baris `RUN python voice_worker/voice_agent.py download-files` —
> model akan di-unduh otomatis saat sesi pertama (hanya lebih lambat sekali).

## 4. Acceptance (SIM-26 "done when")

- [ ] `docker compose config` valid.
- [ ] `docker compose up --build` menjalankan **kedua** proses.
- [ ] `curl -fsS http://localhost:8000/health` → `{"status":"ok"}`.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/token -H 'Content-Type: application/json' -d '{"scenario_id":"kredit-macet"}'` → **401** (bukan 500). 500 = `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` atau kredensial LiveKit belum di-set.
- [ ] `docker compose logs worker` memuat baris registrasi ke LiveKit.
- [ ] Paritas `LIVEKIT_AGENT_NAME` antar proses:
  ```bash
  docker compose exec api    printenv LIVEKIT_AGENT_NAME
  docker compose exec worker printenv LIVEKIT_AGENT_NAME   # HARUS identik
  ```
- [ ] Image bersih dari secret: `docker run --rm koperasi-api sh -c 'ls -a /app | grep -i env || echo none'` → `none`.

> **Catatan lingkungan penulisan:** daemon Docker tidak tersedia saat dokumen ini
> dibuat, sehingga `docker compose up --build` belum dieksekusi di sini. `docker
> compose config` tervalidasi. Operator **wajib** menjalankan acceptance di atas pada
> mesin dengan daemon aktif sebelum menandai SIM-26 selesai.

## Referensi
- `apps/backend/CLAUDE.md` (dua proses, GOTCHAS), `apps/backend/pyproject.toml` (Python 3.12, uv).
- uv Docker: https://docs.astral.sh/uv/guides/integration/docker/
- LiveKit agents deploy/builds: https://docs.livekit.io/deploy/agents/builds/
- Lanjut: [`gcp-backend.md`](./gcp-backend.md) untuk push image + deploy.
