"""
テスト共通フィクスチャ

── DB 分離戦略 ───────────────────────────────────────────────────────────────
各テストはトランザクション内で実行され、テスト終了後にロールバックされる。
  外側: BEGIN TRANSACTION
    内側: ルーターの session.commit() → SAVEPOINT へのコミット
  テスト後: ROLLBACK TRANSACTION → DB に何も残らない

── 認証オーバーライドの設計 ──────────────────────────────────────────────────
client          TEST_USER として認証済み（単一ユーザーのテスト）
client_no_auth  未認証（HTTPBearer が 403 を返す）

【重要】 2ユーザー同時テストについて:
  `app.dependency_overrides` はアプリ全体で共有されるため、
  `client` と `client_other` を同時にフィクスチャとして使うと
  後から設定された方の認証設定が前者を上書きしてしまう。

  そのため、多ユーザーシナリオ（越権アクセステスト等）は
  HTTP クライアントを2つ使う代わりに、SQLAlchemy で直接 DB に
  データを挿入してテストする（test_items.py のコメント参照）。
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from main import app
from database import get_db, settings
from auth import get_current_user

# ── テスト用ユーザー定義 ──────────────────────────────────────────────────────

TEST_USER = {
    "sub": "test-user-001",
    "email": "test@example.com",
    "preferred_username": "testuser",
    "realm_access": {"roles": ["user"]},
}

# 越権アクセステストで「別ユーザーが作成したデータ」を表す owner_id として使用する。
# HTTP クライアントとしては使用しない（DB への直接挿入で代替）。
OTHER_USER_ID = "other-user-002"

# ── テスト用エンジン ──────────────────────────────────────────────────────────
# NullPool: テスト間で接続を共有しない
test_engine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
)


# ── DB セッションフィクスチャ ─────────────────────────────────────────────────

@pytest_asyncio.fixture
async def db_session():
    """
    各テストにトランザクション付きセッションを提供する。

    ルーター内の session.commit() はセーブポイントへのコミットに変換されるため、
    テスト終了後に外側のトランザクションをロールバックすれば
    DB に何も残らない。

    テスト内で直接 DB にデータを挿入する場合もこのセッションを使用する:
        item = Item(name="test", owner_id="xxx")
        db_session.add(item)
        await db_session.flush()  # commit ではなく flush（ロールバック対象に残す）
    """
    async with test_engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(
            bind=conn,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        yield session
        await session.close()
        await conn.rollback()


# ── HTTP クライアントフィクスチャ ─────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    """
    TEST_USER として認証済みのクライアント。

    get_db と get_current_user の両方をオーバーライドする。
    テスト終了後に dependency_overrides をクリアする。
    """
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: TEST_USER

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_no_auth():
    """
    未認証クライアント。
    get_current_user をオーバーライドしないため HTTPBearer が 403 を返す。
    """
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c

    app.dependency_overrides.clear()
