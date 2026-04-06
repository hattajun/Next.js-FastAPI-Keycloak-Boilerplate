"""
FastAPI application entry point.

Architecture follows the Container-level separation described in Chapter 3:
- This service only exposes HTTP and WebSocket endpoints (no UI logic)
- Auth is delegated to Keycloak (external system)
- Data is stored in PostgreSQL (separate container)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, settings
from routers import items, ws, sse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # テーブル作成・スキーマ変更は entrypoint.sh の `alembic upgrade head` が担当。
    # かつては create_all をここで呼んでいたが、Alembic 導入後は削除。
    yield
    await engine.dispose()


app = FastAPI(
    title="Boilerplate API",
    version="1.0.0",
    description="Next.js + FastAPI + PostgreSQL + Keycloak boilerplate",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# allow_credentials=True is required when the frontend sends cookies or
# Authorization headers (Chapter 4 - Security and Cross-Origin Concerns).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(items.router, prefix="/api/items", tags=["Items"])
app.include_router(ws.router, prefix="/api/ws", tags=["WebSocket"])
app.include_router(sse.router, prefix="/api/sse", tags=["SSE"])


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health", tags=["Health"])
async def health():
    """Simple health check endpoint for docker-compose condition checks."""
    return {"status": "ok"}
