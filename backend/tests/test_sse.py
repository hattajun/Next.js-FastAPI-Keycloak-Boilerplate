"""
SSE エンドポイントの統合テスト

テスト対象:
  POST /api/sse/tasks        タスク開始（task_id 発行）
  GET  /api/sse/tasks/{id}   SSE ストリーム配信

── ストリームテストの方針 ─────────────────────────────────────────────────────
SSE ストリームのフル受信テストはデフォルトで約 4.5 秒かかる（asyncio.sleep の合計）。
asyncio.sleep をモックして高速化し、イベントの順序・形式・内容を検証する。
フル受信テストには @pytest.mark.slow を付け、
通常の CI では -m "not slow" でスキップできるようにする。
"""

import json
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient


# ── POST /api/sse/tasks ────────────────────────────────────────────────────────

class TestStartTask:
    async def test_returns_201(self, client: AsyncClient):
        """タスク開始は 201 Created を返す。"""
        res = await client.post("/api/sse/tasks")
        assert res.status_code == 201

    async def test_returns_task_id(self, client: AsyncClient):
        """レスポンスに task_id が含まれる。"""
        res = await client.post("/api/sse/tasks")
        data = res.json()
        assert "task_id" in data

    async def test_task_id_is_8_chars(self, client: AsyncClient):
        """task_id は 8 文字の UUID スラグ。"""
        res = await client.post("/api/sse/tasks")
        assert len(res.json()["task_id"]) == 8

    async def test_task_ids_are_unique(self, client: AsyncClient):
        """同じユーザーでも毎回異なる task_id が発行される。"""
        ids = [
            (await client.post("/api/sse/tasks")).json()["task_id"]
            for _ in range(3)
        ]
        assert len(set(ids)) == 3

    async def test_requires_auth(self, client_no_auth: AsyncClient):
        """未認証は 403 を返す。"""
        res = await client_no_auth.post("/api/sse/tasks")
        assert res.status_code == 403


# ── GET /api/sse/tasks/{task_id} ──────────────────────────────────────────────

class TestStreamTask:
    async def test_unknown_task_returns_404(self, client: AsyncClient):
        """存在しない task_id は 404 を返す。"""
        res = await client.get("/api/sse/tasks/notexist")
        assert res.status_code == 404

    async def test_returns_event_stream_content_type(self, client: AsyncClient):
        """SSE エンドポイントは text/event-stream を返す。"""
        res = await client.post("/api/sse/tasks")
        task_id = res.json()["task_id"]

        with patch("routers.sse.asyncio.sleep", new=AsyncMock()):
            async with client.stream("GET", f"/api/sse/tasks/{task_id}") as stream:
                assert stream.status_code == 200
                content_type = stream.headers.get("content-type", "")
                assert "text/event-stream" in content_type

    @pytest.mark.slow
    async def test_full_stream_events(self, client: AsyncClient):
        """
        SSE ストリームが正しいイベントを順番に送信することを確認する。

        asyncio.sleep をモックして高速化。
        @pytest.mark.slow が付いているため通常の CI では:
          pytest -m "not slow"
        でスキップされる。
        """
        res = await client.post("/api/sse/tasks")
        task_id = res.json()["task_id"]

        events: list[dict] = []
        with patch("routers.sse.asyncio.sleep", new=AsyncMock()):
            async with client.stream("GET", f"/api/sse/tasks/{task_id}") as stream:
                current_event_type = None
                async for line in stream.aiter_lines():
                    line = line.strip()
                    if line.startswith("event:"):
                        current_event_type = line.split(":", 1)[1].strip()
                    elif line.startswith("data:") and current_event_type:
                        data = json.loads(line.split(":", 1)[1].strip())
                        events.append({"type": current_event_type, "data": data})
                        # ── 修正: break は data 処理後に行う ──────────────
                        # event: complete の後に break すると data: 行を
                        # 読む前にループが終了し complete イベントが欠落する。
                        if current_event_type == "complete":
                            break

        # イベント数の確認（status × 4 + complete × 1）
        assert len(events) == 5, (
            f"期待: 5イベント（status×4 + complete×1）、実際: {len(events)}\n"
            f"受信イベント: {[e['type'] for e in events]}"
        )

        # 最後のイベントが complete
        assert events[-1]["type"] == "complete"
        assert events[-1]["data"]["progress"] == 100
        assert events[-1]["data"]["step"] == "complete"

        # status イベントのプログレスが単調増加
        status_events = [e for e in events if e["type"] == "status"]
        progresses = [e["data"]["progress"] for e in status_events]
        assert progresses == sorted(progresses), "プログレスが単調増加でない"
        assert all(0 < p < 100 for p in progresses), "プログレスが 0-100 の範囲外"

        # 全イベントに task_id が含まれる
        for event in events:
            assert event["data"]["task_id"] == task_id

    @pytest.mark.slow
    async def test_task_cleaned_up_after_completion(self, client: AsyncClient):
        """タスク完了後、同じ task_id で再接続すると 404 になる。"""
        from routers.sse import _task_store

        res = await client.post("/api/sse/tasks")
        task_id = res.json()["task_id"]
        assert task_id in _task_store

        with patch("routers.sse.asyncio.sleep", new=AsyncMock()):
            async with client.stream("GET", f"/api/sse/tasks/{task_id}") as stream:
                async for line in stream.aiter_lines():
                    if "complete" in line:
                        break

        assert task_id not in _task_store
