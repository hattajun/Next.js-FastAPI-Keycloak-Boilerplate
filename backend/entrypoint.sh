#!/bin/bash
# =============================================================================
# entrypoint.sh  ─  本番用エントリーポイント
#
# 起動フロー:
#   1. DB 接続確認（最大10回リトライ）
#   2. Alembic マイグレーション（upgrade head）
#   3. uvicorn 起動（--reload なし・debugpy なし）
#
# 開発環境でデバッグしながら起動したい場合は entrypoint.dev.sh を使用する。
# docker-compose.yml がデフォルトで entrypoint.dev.sh に切り替え済み。
#
# 注意: このファイルは `bash entrypoint.sh` で実行される（Dockerfile 参照）。
#   `./entrypoint.sh` は使用しない。
#   理由: ボリュームマウント（./backend:/app）が Dockerfile の chmod を上書きし、
#         WSL2 + Windows ファイルシステムでは実行権限が失われるため。
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

# ── アプリケーション起動（本番） ────────────────────────────────────────────
# --reload なし・debugpy なし
echo "=== uvicorn: 起動中（本番モード）==="
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000
