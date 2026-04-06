FROM python:3.12-slim

WORKDIR /app

# ── 依存関係インストール ───────────────────────────────────────────────────
# ARG INSTALL_DEV:
#   true  → requirements.txt + requirements-dev.txt（pytest / debugpy など）
#   false → requirements.txt のみ（本番用）
#
# docker-compose.yml     が INSTALL_DEV=true  を渡す（開発用）
# docker-compose.prod.yml が INSTALL_DEV=false を渡す（本番用）
ARG INSTALL_DEV=false

COPY requirements.txt requirements-dev.txt ./
RUN if [ "$INSTALL_DEV" = "true" ]; then \
        pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt; \
    else \
        pip install --no-cache-dir -r requirements.txt; \
    fi

COPY . .

EXPOSE 8000

# デフォルト CMD は本番用エントリーポイント。
# 開発時は docker-compose.yml が command: ["bash", "entrypoint.dev.sh"] で上書きする。
#
# ボリュームマウント（./backend:/app）は Dockerfile のファイルを上書きする。
# WSL2 + Windows ファイルシステムでは Unix 実行権限が失われるため、
# `./entrypoint.sh` ではなく `bash entrypoint.sh` で呼び出す。
CMD ["bash", "entrypoint.sh"]
