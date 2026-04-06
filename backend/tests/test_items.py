"""
items エンドポイントの統合テスト

── 多ユーザーシナリオのテスト方針 ────────────────────────────────────────────
越権アクセスのテスト（他ユーザーのリソースへのアクセス制御）では、
HTTP クライアントを2つ使う代わりに SQLAlchemy で直接 DB に
他ユーザーのデータを挿入する。

理由:
  app.dependency_overrides は FastAPI アプリ全体で共有される単一の dict。
  2つのフィクスチャ（client と client_other）が同時に override を設定すると
  後から設定された方が先のものを上書きし、認証ユーザーの区別が消える。

方針:
  ✅ 他ユーザーデータの作成 → db_session.add(Item(owner_id=OTHER_USER_ID))
  ✅ 自ユーザーとしてのアクセス → client（TEST_USER）でリクエスト
  ❌ client_other フィクスチャは使用しない
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models.item import Item
from tests.conftest import OTHER_USER_ID


# ── GET /api/items/ ────────────────────────────────────────────────────────────

class TestListItems:
    async def test_empty_list_initially(self, client: AsyncClient):
        """新規ユーザーはアイテムを持っていない。"""
        res = await client.get("/api/items/")
        assert res.status_code == 200
        data = res.json()
        assert data["items"] == []
        assert data["total"] == 0

    async def test_returns_only_own_items(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """ユーザーは自分のアイテムのみ取得できる（他ユーザーのは見えない）。

        他ユーザーのアイテムを DB に直接挿入し、
        TEST_USER でアクセスしても見えないことを確認する。
        """
        # 他ユーザーのアイテムを DB に直接挿入
        other_item = Item(name="Other User Item", owner_id=OTHER_USER_ID)
        db_session.add(other_item)
        await db_session.flush()

        # TEST_USER には OTHER_USER のアイテムは見えない
        res = await client.get("/api/items/")
        assert res.status_code == 200
        data = res.json()
        assert data["items"] == []
        assert data["total"] == 0

    async def test_own_items_are_visible(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """自分のアイテムは見えるが、他ユーザーのアイテムは見えない。"""
        # TEST_USER のアイテムを HTTP 経由で作成
        await client.post("/api/items/", json={"name": "My Item"})

        # OTHER_USER のアイテムを直接 DB に挿入
        other_item = Item(name="Not My Item", owner_id=OTHER_USER_ID)
        db_session.add(other_item)
        await db_session.flush()

        res = await client.get("/api/items/")
        names = [item["name"] for item in res.json()["items"]]
        assert "My Item" in names
        assert "Not My Item" not in names

    async def test_returns_multiple_items(self, client: AsyncClient):
        """作成したアイテムが全件返される。"""
        await client.post("/api/items/", json={"name": "Item A"})
        await client.post("/api/items/", json={"name": "Item B"})

        res = await client.get("/api/items/")
        assert res.status_code == 200
        names = [item["name"] for item in res.json()["items"]]
        assert "Item A" in names
        assert "Item B" in names

    async def test_pagination_skip_and_limit(self, client: AsyncClient):
        """skip / limit でページネーションが機能する。"""
        for i in range(5):
            await client.post("/api/items/", json={"name": f"Item {i}"})

        res = await client.get("/api/items/?skip=0&limit=3")
        data = res.json()
        assert data["total"] == 5
        assert len(data["items"]) == 3

        res2 = await client.get("/api/items/?skip=3&limit=3")
        data2 = res2.json()
        assert data2["total"] == 5
        assert len(data2["items"]) == 2

    async def test_requires_auth(self, client_no_auth: AsyncClient):
        """未認証は 403 を返す。"""
        res = await client_no_auth.get("/api/items/")
        assert res.status_code == 403


# ── POST /api/items/ ───────────────────────────────────────────────────────────

class TestCreateItem:
    async def test_returns_201(self, client: AsyncClient):
        """作成成功は 201 Created を返す。"""
        res = await client.post("/api/items/", json={"name": "New Item"})
        assert res.status_code == 201

    async def test_response_contains_expected_fields(self, client: AsyncClient):
        """レスポンスに必要なフィールドが含まれている。"""
        res = await client.post("/api/items/", json={
            "name": "Test Item",
            "description": "A description",
        })
        data = res.json()
        assert data["name"] == "Test Item"
        assert data["description"] == "A description"
        assert isinstance(data["id"], int)
        assert data["owner_id"] == "test-user-001"

    async def test_description_is_optional(self, client: AsyncClient):
        """description は省略可能で None になる。"""
        res = await client.post("/api/items/", json={"name": "No Desc"})
        assert res.status_code == 201
        assert res.json()["description"] is None

    async def test_missing_name_returns_422(self, client: AsyncClient):
        """name が欠けている場合は 422 Unprocessable Entity を返す。"""
        res = await client.post("/api/items/", json={})
        assert res.status_code == 422

    async def test_created_item_appears_in_list(self, client: AsyncClient):
        """作成後に一覧取得で確認できる。"""
        create_res = await client.post("/api/items/", json={"name": "Check Item"})
        item_id = create_res.json()["id"]

        list_res = await client.get("/api/items/")
        ids = [item["id"] for item in list_res.json()["items"]]
        assert item_id in ids

    async def test_requires_auth(self, client_no_auth: AsyncClient):
        """未認証は 403 を返す。"""
        res = await client_no_auth.post("/api/items/", json={"name": "Test"})
        assert res.status_code == 403


# ── GET /api/items/{id} ────────────────────────────────────────────────────────

class TestGetItem:
    async def test_get_own_item(self, client: AsyncClient):
        """自分のアイテムを取得できる。"""
        create_res = await client.post("/api/items/", json={"name": "My Item"})
        item_id = create_res.json()["id"]

        res = await client.get(f"/api/items/{item_id}")
        assert res.status_code == 200
        assert res.json()["name"] == "My Item"
        assert res.json()["id"] == item_id

    async def test_nonexistent_returns_404(self, client: AsyncClient):
        """存在しないアイテムは 404 を返す。"""
        res = await client.get("/api/items/999999")
        assert res.status_code == 404

    async def test_other_users_item_returns_404(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """他ユーザーのアイテムは 404 を返す（所有者スコープの保護）。

        DB に OTHER_USER のアイテムを直接挿入し、
        TEST_USER でアクセスしても 404 になることを確認する。
        """
        other_item = Item(name="Other's Private Item", owner_id=OTHER_USER_ID)
        db_session.add(other_item)
        await db_session.flush()

        res = await client.get(f"/api/items/{other_item.id}")
        assert res.status_code == 404

    async def test_requires_auth(self, client_no_auth: AsyncClient):
        """未認証は 403 を返す。"""
        res = await client_no_auth.get("/api/items/1")
        assert res.status_code == 403


# ── DELETE /api/items/{id} ─────────────────────────────────────────────────────

class TestDeleteItem:
    async def test_delete_returns_204(self, client: AsyncClient):
        """削除成功は 204 No Content を返す（ボディなし）。"""
        create_res = await client.post("/api/items/", json={"name": "To Delete"})
        item_id = create_res.json()["id"]

        res = await client.delete(f"/api/items/{item_id}")
        assert res.status_code == 204
        assert res.content == b""

    async def test_deleted_item_is_gone(self, client: AsyncClient):
        """削除後に GET すると 404 になる。"""
        create_res = await client.post("/api/items/", json={"name": "To Delete"})
        item_id = create_res.json()["id"]

        await client.delete(f"/api/items/{item_id}")

        res = await client.get(f"/api/items/{item_id}")
        assert res.status_code == 404

    async def test_deleted_item_absent_from_list(self, client: AsyncClient):
        """削除後に一覧から消える。"""
        create_res = await client.post("/api/items/", json={"name": "Gone"})
        item_id = create_res.json()["id"]

        await client.delete(f"/api/items/{item_id}")

        list_res = await client.get("/api/items/")
        ids = [item["id"] for item in list_res.json()["items"]]
        assert item_id not in ids

    async def test_nonexistent_returns_404(self, client: AsyncClient):
        """存在しないアイテムの削除は 404 を返す。"""
        res = await client.delete("/api/items/999999")
        assert res.status_code == 404

    async def test_other_users_item_returns_404(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """他ユーザーのアイテムは削除できない（404 を返す）。

        DB に OTHER_USER のアイテムを直接挿入し、
        TEST_USER が削除しようとしても 404 になることを確認する。
        アイテムが削除されていないことも合わせて確認する。
        """
        other_item = Item(name="Protected Item", owner_id=OTHER_USER_ID)
        db_session.add(other_item)
        await db_session.flush()

        # TEST_USER が OTHER_USER のアイテムを削除しようとする → 404
        res = await client.delete(f"/api/items/{other_item.id}")
        assert res.status_code == 404

        # アイテムはまだ DB に存在する（削除されていない）
        await db_session.refresh(other_item)
        assert other_item.id is not None

    async def test_requires_auth(self, client_no_auth: AsyncClient):
        """未認証は 403 を返す。"""
        res = await client_no_auth.delete("/api/items/1")
        assert res.status_code == 403


# ── GET /api/health ────────────────────────────────────────────────────────────

class TestHealthCheck:
    async def test_returns_ok(self, client: AsyncClient):
        """ヘルスチェックは {"status": "ok"} を返す。"""
        res = await client.get("/api/health")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    async def test_does_not_require_auth(self, client_no_auth: AsyncClient):
        """ヘルスチェックは認証不要。"""
        res = await client_no_auth.get("/api/health")
        assert res.status_code == 200
