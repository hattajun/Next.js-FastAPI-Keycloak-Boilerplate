"""
WebSocket endpoint — 認証付きブロードキャストチャット

Chapter 4（WebSockets セクション）の双方向通信パターンに
チケットベース認証を追加した実装。

── ブラウザの WebSocket API の制約 ─────────────────────────────────────────
ブラウザの WebSocket API はカスタムヘッダー（Authorization 等）を
送信できないため、Bearer トークンによる直接認証ができない。

── SSE と同じチケット方式で解決 ────────────────────────────────────────────
SSE（sse.py）と同一のパターンを採用する:

  Step 1: POST /api/ws/tickets
          → Bearer トークンで Keycloak 認証
          → 短命な ws_ticket（60秒 TTL）を発行
          → ユーザー情報をチケットに紐付けて保存

  Step 2: WebSocket ws://host/ws/{client_id}?ticket={ws_ticket}
          → チケットの存在確認・TTL チェック
          → 有効なら接続確立・使用済みにする（一度きり）
          → 無効なら 4008 Policy Violation で即切断

── チケットの安全性 ────────────────────────────────────────────────────────
  - UUID v4 ベース（推測困難）
  - 60 秒 TTL（期限切れは自動拒否）
  - 一度使ったら即削除（再利用不可）
  - URL に含まれるため、本番環境では HTTPS/WSS が必須
"""

import json
import logging
import time
import uuid
from typing import Dict

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi import HTTPException, status

from auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ── チケットストア（インメモリ・デモ用）──────────────────────────────────────
# 本番環境では Redis 等の外部ストアに移行し、TTL を Redis の EXPIRE で管理する

_TICKET_TTL_SECONDS = 60

class _Ticket:
    def __init__(self, user_sub: str, username: str) -> None:
        self.user_sub  = user_sub
        self.username  = username
        self.expires_at = time.monotonic() + _TICKET_TTL_SECONDS

    def is_expired(self) -> bool:
        return time.monotonic() > self.expires_at

_ticket_store: Dict[str, _Ticket] = {}


# ── WebSocket 接続管理 ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self._connections: Dict[str, WebSocket] = {}

    async def connect(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[client_id] = websocket
        logger.info("WS connected: %s (total: %d)", client_id, len(self._connections))

    def disconnect(self, client_id: str) -> None:
        self._connections.pop(client_id, None)
        logger.info("WS disconnected: %s (total: %d)", client_id, len(self._connections))

    async def broadcast(self, payload: dict) -> None:
        message = json.dumps(payload, ensure_ascii=False)
        for client_id, ws in list(self._connections.items()):
            try:
                await ws.send_text(message)
            except Exception:
                self.disconnect(client_id)

manager = ConnectionManager()


# ── エンドポイント ────────────────────────────────────────────────────────────

@router.post("/tickets", status_code=status.HTTP_201_CREATED)
async def issue_ws_ticket(
    current_user: dict = Depends(get_current_user),
):
    """
    WebSocket 接続用の短命チケットを発行する。

    Bearer トークンで認証し、60 秒間有効な ws_ticket を返す。
    クライアントはこのチケットを WebSocket の URL クエリパラメータに含めて接続する。

    Returns:
        {"ws_ticket": "<uuid>", "expires_in": 60}
    """
    ticket_id = str(uuid.uuid4())
    _ticket_store[ticket_id] = _Ticket(
        user_sub=current_user["sub"],
        username=current_user.get("preferred_username", current_user["sub"]),
    )
    return {"ws_ticket": ticket_id, "expires_in": _TICKET_TTL_SECONDS}


@router.websocket("/ws/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    client_id: str,
) -> None:
    """
    認証付き WebSocket エンドポイント。

    接続時に ?ticket=<ws_ticket> クエリパラメータを検証する。
    無効・期限切れ・未指定の場合は 4008 で即切断する。

    WebSocket クローズコード:
        4008 Policy Violation — 認証失敗（無効・期限切れ・未指定）
    """
    # ── チケット検証 ───────────────────────────────────────────────────────
    ticket_id = websocket.query_params.get("ticket")

    if not ticket_id or ticket_id not in _ticket_store:
        # accept() してから close() しないとブラウザがエラーを受け取れない
        await websocket.accept()
        await websocket.close(code=4008, reason="Missing or invalid ticket")
        return

    ticket = _ticket_store.pop(ticket_id)  # 一度使ったら削除（再利用不可）

    if ticket.is_expired():
        await websocket.accept()
        await websocket.close(code=4008, reason="Ticket expired")
        return

    # ── 接続確立 ──────────────────────────────────────────────────────────
    display_name = ticket.username
    await manager.connect(client_id, websocket)
    await manager.broadcast({
        "type": "system",
        "message": f"{display_name} が参加しました",
        "client_id": None,
    })

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                message = str(data.get("message", "")).strip()
            except (json.JSONDecodeError, AttributeError):
                message = raw.strip()

            if message:
                await manager.broadcast({
                    "type": "message",
                    "client_id": display_name,
                    "message": message,
                })
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast({
            "type": "system",
            "message": f"{display_name} が退出しました",
            "client_id": None,
        })
