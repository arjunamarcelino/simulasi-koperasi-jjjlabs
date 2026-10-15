# apps/backend/Dockerfile — satu file multi-stage, dua target (api + worker).
# Keduanya berbagi satu layer `uv sync` (deps mahal, di-cache sekali).
# Build:  docker build --target api    -t koperasi-api    .
#         docker build --target worker -t koperasi-worker .
# (lebih mudah lewat docker-compose.yml — lihat docs/deploy/backend-containers.md)

# ---- base: deps + project terinstal, user non-root --------------------------
FROM python:3.12-slim AS base
# uv di-pin (bukan :latest) agar build reproducible. Sesuaikan ke versi yang Anda uji.
COPY --from=ghcr.io/astral-sh/uv:0.11.19 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app

# Layer 1 (lambat, jarang berubah): deps saja — bind-mount lock+pyproject, tanpa project.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev --no-editable

# Layer 2 (cepat, sering berubah): kode project.
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# User non-root + cache model yang writable (download-files menulis ke sini).
ENV HF_HOME=/app/.cache/huggingface \
    XDG_CACHE_HOME=/app/.cache
RUN groupadd --system app && useradd --system --gid app --no-create-home app \
    && mkdir -p /app/.cache && chown -R app:app /app
USER app
ENV PATH="/app/.venv/bin:$PATH"

# ---- api: FastAPI token server (HTTP) ---------------------------------------
FROM base AS api
# Cloud Run merutekan ke $PORT (default 8080). `exec` agar SIGTERM sampai ke uvicorn.
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn api.server:app --host 0.0.0.0 --port ${PORT:-8000}"]

# ---- worker: LiveKit voice worker (outbound-only, tanpa inbound port) --------
FROM base AS worker
# Bake bobot VAD/turn-detector agar sesi pertama tak lambat. Butuh jaringan saat build.
# ⚠️ Verifikasi subcommand `download-files` ada di versi livekit-agents terpasang;
#    jika gagal/berbeda, hapus baris ini — model akan di-unduh saat sesi pertama.
RUN python voice_worker/voice_agent.py download-files
# exec-form → SIGTERM diteruskan untuk graceful drain (framework drain job aktif).
# `start` = mode produksi (bukan `dev`); argv diteruskan via cli.run_app(server).
CMD ["python", "voice_worker/voice_agent.py", "start"]
