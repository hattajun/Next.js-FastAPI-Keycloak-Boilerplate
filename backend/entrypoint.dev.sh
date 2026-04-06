#!/bin/bash
# =============================================================================
# entrypoint.dev.sh  ─  開発用エントリーポイント
#
# 起動フロー:
#   1. DB 接続確認（最大10回リトライ）
#   2. Alembic マイグレーション（upgrade head）
#   3. debugpy 経由で uvicorn 起動
#      - ポート 5678 でデバッガ接続を待ち受ける（--wait-for-client なし）
#      - --reload 有効（ファイル変更時に自動再起動）
#
# VSCode からのアタッチ方法:
#   「FastAPI: attach to Docker container」を選択（launch.json 参照）
#
# 本番環境では entrypoint.sh を使用する（docker-compose.prod.yml）。
#
# 注意: このファイルは `bash entrypoint.dev.sh` で実行される（Dockerfile 参照）。
# =============================================================================

set -e  # エラーが発生したら即座に終了

# ── DB の起動を待つ ────────────────────────────────────────────────────────
echo "=== DB 接続確認中... ==="
MAX_RETRIES=10
RETRY=0
until python -c "
import asyncio, sys
from sqlalchemy.ext.asyncio import create_async_engine
from database import settings

async def check():
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.connect():
            pass
        await engine.dispose()
    except Exception as e:
        await engine.dispose()
        sys.exit(1)

asyncio.run(check())
" 2>/dev/null; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "ERROR: DB への接続に失敗しました（${MAX_RETRIES}回試行）"
        exit 1
    fi
    echo "    DB 未起動。リトライ ${RETRY}/${MAX_RETRIES}..."
    sleep 2
done
echo "=== DB 接続確認: OK ==="

# ── Alembic マイグレーション ───────────────────────────────────────────────
echo "=== Alembic: マイグレーション実行中... ==="
alembic upgrade head
echo "=== Alembic: 完了 ==="

# ── アプリケーション起動（開発・デバッグ） ──────────────────────────────────
# debugpy でポート 5678 をリッスンしながら uvicorn を起動する。
# --wait-for-client は指定しない（デバッガ未接続でもサーバーは通常起動する）。
echo "=== uvicorn: 起動中（開発モード / debugpy listen :5678）==="
exec python -m debugpy --listen 0.0.0.0:5678 \
    -m uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload
