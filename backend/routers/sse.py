"""
Server-Sent Events (SSE) — デモ実装

Chapter 4「Server-Sent Events (SSE)」セクションを実装したサンプルです。

── EventSource の認証問題と解決策 ─────────────────────────────────────────
ブラウザの EventSource API は GET リクエストしか送れず、
Authorization ヘッダーをカスタム設定できません。

そのため以下の 2 ステップに分割します:
  1. POST /api/sse/tasks          → Bearer トークンで認証し task_id を発行
  2. GET  /api/sse/tasks/{task_id} → task_id を暗黙の認証トークンとして使用

task_id は UUIDv4 の先頭 8 文字で、推測が困難かつ短命（完了後に削除）のため
デモ用途として十分な安全性を持ちます。

── SSE フォーマット ─────────────────────────────────────────────────────────
各イベントは以下の形式で送信されます:

    event: status
    data: {"task_id": "a1b2c3d4", "step": "fetch", "message": "...", "progress": 40}

    event: complete
    data: {"task_id": "a1b2c3d4", "step": "complete", "message": "完了!", "progress": 100}

"""

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from auth import get_current_user

router = APIRouter()

# ── タスクストア（インメモリ・デモ用）────────────────────────────────────────
# 本番環境では Redis 等の外部ストアに移行し TTL を設定すること
_task_store: dict[str, str] = {}  # task_id → user_sub

# ── タスクのステップ定義 ──────────────────────────────────────────────────────
_STEPS = [
    {"step": "init",     "message": "タスクを初期化中...",    "progress": 20},
    {"step": "fetch",    "message": "データを取得中...",      "progress": 40},
    {"step": "process",  "message": "データを処理中...",      "progress": 70},
    {"step": "validate", "message": "結果を検証中...",        "progress": 90},
]


async def _generate_events(task_id: str) -> AsyncGenerator[str, None]:
    """
    SSE イベントを非同期ジェネレーターとして生成する。

    各ステップの間に asyncio.sleep を挟むことで、他のリクエストの処理を
    ブロックせずに時間のかかる処理をシミュレートしています。
    """
    for step in _STEPS:
        await asyncio.sleep(1)
        data = json.dumps({"task_id": task_id, **step})
        yield f"event: status\ndata: {data}\n\n"

    # 最終イベント（complete）
    await asyncio.sleep(0.5)
    complete_data = json.dumps({
        "task_id": task_id,
        "step": "complete",
        "message": "タスクが完了しました！",
        "progress": 100,
    })
    yield f"event: complete\ndata: {complete_data}\n\n"

    # 完了後にクリーンアップ
    _task_store.pop(task_id, None)


# ── エンドポイント ────────────────────────────────────────────────────────────

@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def start_task(current_user: dict = Depends(get_current_user)):
    """
    タスクを開始し task_id を返す。

    クライアントはこの task_id を使って GET /api/sse/tasks/{task_id} に
    EventSource で接続し、進捗イベントを受信する。
    """
    task_id = str(uuid.uuid4())[:8]
    _task_store[task_id] = current_user["sub"]
    return {"task_id": task_id}


@router.get("/tasks/{task_id}")
async def stream_task_events(task_id: str):
    """
    SSE ストリームを返す。

    - task_id が存在する場合のみ接続を許可（task_id が暗黙の認証トークン）
    - レスポンスは text/event-stream 形式
    - X-Accel-Buffering: no で nginx のバッファリングを無効化
    """
    if task_id not in _task_store:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or already completed.",
        )

    return StreamingResponse(
        _generate_events(task_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx にバッファリングを無効化させる特殊ヘッダー
            "X-Accel-Buffering": "no",
        },
    )
