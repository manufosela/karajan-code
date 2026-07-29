# ==============================================================================
# Stage 1: Build dependencies with uv
# ==============================================================================
FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml ./

RUN uv pip install --system --no-cache -r pyproject.toml

# ==============================================================================
# Stage 2: Runtime
# ==============================================================================
FROM python:3.12-slim AS runtime

RUN groupadd --gid 1000 appuser && \
    useradd --uid 1000 --gid 1000 --create-home appuser

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

WORKDIR /app

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./

RUN chown -R appuser:appuser /app

USER appuser

# Cloud Run uses PORT env var (default 8080)
ENV PORT=8080

EXPOSE ${PORT}

CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 2
