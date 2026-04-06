"""
Alembic マイグレーション環境設定

ポイント:
  アプリは asyncpg（非同期）を使用するが、Alembic は同期接続が前提のため
  DATABASE_URL の asyncpg を psycopg2 に置き換えて使用する。

  autogenerate を有効にするため、全 ORM モデルをここでインポートする。
  新しいモデルを追加したら、このファイルへのインポートも追加すること。
"""

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# backend/ をパスに追加（database.py, models/ を import できるようにする）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import Base

# autogenerate のために全モデルをインポートする
# 新しいモデルを追加したらここに追記すること
import models.item  # noqa: F401

# ── Alembic 設定 ──────────────────────────────────────────────────────────────
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate の比較対象となるメタデータ
target_metadata = Base.metadata


def get_sync_url() -> str:
    """
    DATABASE_URL を環境変数から取得し、Alembic 用の同期 URL に変換する。

    アプリ: postgresql+asyncpg://...  （非同期）
    Alembic: postgresql+psycopg2://...（同期）
    """
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@db:5432/appdb",
    )
    return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")


# ── オフラインモード（DB 接続なし・SQL 生成のみ）─────────────────────────────
def run_migrations_offline() -> None:
    """
    DB に接続せず SQL スクリプトを生成するモード。
    `alembic upgrade head --sql` で使用。
    """
    context.configure(
        url=get_sync_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ── オンラインモード（DB に接続してマイグレーション実行）─────────────────────
def run_migrations_online() -> None:
    """
    DB に接続してマイグレーションを実行するモード。
    通常の `alembic upgrade head` で使用。
    """
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = get_sync_url()

    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        # NullPool: マイグレーション完了後すぐに接続を閉じる
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # カラムの型変更を autogenerate で検出する
            compare_type=True,
            # サーバーデフォルト値の変更を検出する
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
