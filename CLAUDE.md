# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の指示書です。
コードを書く前に必ずこのファイルを読んでください。

---

## プロジェクト概要

Next.js + FastAPI + PostgreSQL + Keycloak によるフルスタック Web アプリの**ボイラープレート**です。
新機能の追加・変更は、このボイラープレートの設計思想と整合性を保つように実装してください。

---

## アーキテクチャ

```
ブラウザ
  └─→ nginx :80                   # リバースプロキシ（単一エントリーポイント）
        ├─→ /ws/      → backend   # WebSocket
        ├─→ /api/sse/ → backend   # SSE（バッファリング無効）
        ├─→ /api/auth/→ frontend  # NextAuth
        ├─→ /api/     → backend   # FastAPI REST
        └─→ /         → frontend  # Next.js
```

### サービス構成（docker-compose.yml）

| サービス名 | 役割 | ポート |
|---|---|---|
| `nginx` | リバースプロキシ・セキュリティヘッダー付与 | 80 |
| `frontend` | Next.js | 3000（デバッグ用） |
| `backend` | FastAPI | 8000（デバッグ用） |
| `db` | PostgreSQL（アプリ用） | 5432 |
| `keycloak` | 認証サーバー | 8080 |
| `keycloak-db` | PostgreSQL（Keycloak用） | — |

---

## ディレクトリ構成と責務

```
boilerplate/
├── docker-compose.yml              # 開発用（デフォルト）
├── docker-compose.prod.yml         # 本番用
├── frontend/src/
│   ├── app/
│   │   ├── page.tsx                # 公開ページ（未認証はここで止まる）
│   │   └── dashboard/
│   │       ├── page.tsx            # 概要・ナビゲーション
│   │       ├── rest-api/page.tsx   # REST API デモ
│   │       ├── websocket/page.tsx  # WebSocket デモ
│   │       └── sse/page.tsx        # SSE デモ
│   ├── components/
│   │   ├── RestApiDemo.tsx         # REST CRUD デモ
│   │   ├── WebSocketDemo.tsx       # WebSocket チャットデモ
│   │   └── SseDemo.tsx             # SSE 進捗デモ
│   └── lib/
│       ├── auth.ts                 # NextAuth + Keycloak 設定（変更不要）
│       └── fetch.ts                # fetchWithRetry ユーティリティ
├── frontend/
│   ├── Dockerfile                  # 開発用（next dev / inspector 有効）
│   └── Dockerfile.prod             # 本番用（マルチステージ / next build → start）
├── backend/
│   ├── main.py                     # FastAPI アプリ
│   ├── entrypoint.sh               # 本番用（--reload なし・debugpy なし）
│   ├── entrypoint.dev.sh           # 開発用（--reload あり・debugpy :5678）
│   ├── alembic.ini                 # Alembic 設定
│   ├── alembic/
│   │   ├── env.py                  # マイグレーション環境設定
│   │   └── versions/               # マイグレーションファイル群
│   ├── auth.py                     # Keycloak JWT 検証（変更不要）
│   └── routers/
│       ├── items.py                # REST CRUD エンドポイント
│       ├── ws.py                   # WebSocket エンドポイント
│       └── sse.py                  # SSE エンドポイント
└── nginx/nginx.conf                # ルーティング + セキュリティヘッダー
```

### 開発環境と本番環境の違い

| 項目 | 開発（`docker-compose.yml`） | 本番（`docker-compose.prod.yml`） |
|---|---|---|
| backend entrypoint | `entrypoint.dev.sh` | `entrypoint.sh` |
| uvicorn | `--reload` あり | `--reload` なし |
| debugpy | `:5678` で待ち受け | なし |
| Node.js inspector | `:9229` で待ち受け | なし |
| コードマウント | ホスト→コンテナ（HMR 用） | コンテナに焼き込み |
| backend 依存 | `requirements-dev.txt` も含む | `requirements.txt` のみ |
| frontend 起動 | `next dev`（HMR 有効） | `next build → next start` |

---

## 開発コマンド

```bash
# ── 開発環境（docker-compose.yml） ──────────────────────────────────────
# 通常の起動（entrypoint.dev.sh / debugpy / --reload / HMR 有効）
docker compose up --build

# ボリュームごと削除して再起動（Keycloak 設定変更時）
docker compose down -v && docker compose up --build

# ログ確認
docker compose logs -f backend
docker compose logs -f frontend

# ── 本番環境（docker-compose.prod.yml） ─────────────────────────────────
# 本番イメージをビルドして起動（entrypoint.sh / --reload なし / debugpy なし）
docker compose -f docker-compose.prod.yml up --build

# 本番環境を停止
docker compose -f docker-compose.prod.yml down
```

---

## コーディング規約

### フロントエンド（TypeScript / Next.js）

**認証チェックはサーバーコンポーネントで行う**
```typescript
// ✅ 正しい
import { getServerSession } from 'next-auth'
export default async function ProtectedPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')
}
```

**クライアントからの API 呼び出し**
```typescript
// ✅ Bearer トークンを付与する
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/items/`, {
  headers: { Authorization: `Bearer ${session.accessToken}` }
})
```

**新しいデモページの追加パターン**
1. `frontend/src/components/XxxDemo.tsx` を作成
2. `frontend/src/app/dashboard/xxx/page.tsx` を作成（サーバーコンポーネント + 認証チェック）
3. `NavBar.tsx` の `NAV_LINKS` に追加
4. `dashboard/page.tsx` に `DemoCard` を追加

**スタイリング**
- `globals.css` の CSS 変数（`--color-primary` 等）を使用する
- レイアウトとコンポーネントを分離する（Chapter 7 準拠）
- Tailwind CSS は使用しない

### バックエンド（Python / FastAPI）

**新しいエンドポイントの追加手順**
1. `backend/models/` に SQLAlchemy モデルを追加（必要な場合）
2. `backend/routers/` に新しいルーターファイルを作成
3. `backend/main.py` に `app.include_router()` を追加

**HTTP ステータスコードの使い分け（Chapter 4 準拠）**
```python
status.HTTP_201_CREATED          # 作成成功
status.HTTP_204_NO_CONTENT       # 削除成功（ボディなし）
status.HTTP_404_NOT_FOUND        # 見つからない
status.HTTP_422_UNPROCESSABLE_ENTITY  # バリデーションエラー
```

**認証の扱い**
- `auth.py` の `get_current_user` は変更しない
- `current_user["sub"]` が Keycloak のユーザー ID
- `current_user["realm_access"]["roles"]` でロール確認

### テスト

#### バックエンド（pytest）

```bash
# コンテナ起動後に実行する（DB・Alembic が必要）
docker compose up -d

# 全テスト実行（通常）
docker compose exec backend pytest

# slow マーカーを除いた高速実行（CI 向け）
docker compose exec backend pytest -m "not slow"

# カバレッジ付き
docker compose exec backend pytest --cov=. --cov-report=term-missing

# 特定のファイルのみ
docker compose exec backend pytest tests/test_items.py -v
```

#### フロントエンド（Jest）

```bash
# frontend/ ディレクトリ内で実行（コンテナ不要）
cd frontend && npm install

# 全テスト
npm test

# ウォッチモード（開発中に便利）
npm run test:watch

# カバレッジ付き
npm run test:coverage
```

VSCode の場合: `Ctrl+Shift+P` → "Tasks: Run Task" → `test:` / `frontend: test` から選択。

### テスト構成

```
backend/tests/
├── conftest.py           DB・認証フィクスチャ
├── test_items.py         CRUD 全パターン（正常系・404・422・403・越権）
├── test_sse.py           SSE エンドポイント（タスク発行・stream content-type）
└── test_migrations.py    マイグレーションファイルの静的チェック

frontend/src/lib/__tests__/
└── fetch.test.ts         fetchWithRetry の全パターン（正常系・リトライ・4xx・コールバック）
```

### DB 分離戦略（バックエンド）

各テストはトランザクション内で実行され、テスト後にロールバックされる。`session.commit()` はセーブポイントへのコミットに変換されるため、テスト間で DB の状態が汚染されない。

### 多ユーザーテストの方針

`app.dependency_overrides` はアプリ全体で共有される単一の dict のため、
2つのクライアントに異なる認証設定を同時に適用できない。

他ユーザーのデータを使うテストでは HTTP 経由ではなく SQLAlchemy で直接 DB に挿入する:

```python
# ✅ 正しい: DB に直接挿入
other_item = Item(name="Other's Item", owner_id=OTHER_USER_ID)
db_session.add(other_item)
await db_session.flush()
res = await client.get(f"/api/items/{other_item.id}")  # 404 を確認

# ❌ 避ける: client_other は dependency_overrides を上書きしてしまう
res = await client_other.get(...)
```

### マーカー（バックエンド）

```
pytest -m slow       SSEフル受信テスト（約4秒）
pytest -m "not slow" 高速テストのみ（デフォルト推奨）
pytest -m migration  DB変更を伴うマイグレーションテスト（別途実行）
```

### 新しい関数・エンドポイントを追加したときのテスト手順

**バックエンド:**
1. `tests/test_xxx.py` を作成
2. `conftest.py` の `client` / `client_no_auth` フィクスチャを使う
3. 正常系・404・422・403・越権アクセスを必ずテストする

**フロントエンド (`src/lib/`):**
1. `src/lib/__tests__/新関数.test.ts` を作成
2. `global.fetch = jest.fn()` でモック
3. `baseDelay: 0, jitter: 0` で待機なしにする

---

## Alembic マイグレーション

**モデルを変更したら必ずマイグレーションファイルを作成すること。**
`create_all` は削除済みのため、マイグレーションなしではスキーマが変わらない。

```bash
# 1. モデル変更後、差分マイグレーションを自動生成
docker compose exec backend alembic revision --autogenerate -m "add_tags_to_items"

# 2. 生成されたファイルを必ず確認・修正（autogenerate は完全ではない）
# backend/alembic/versions/YYYYMMDD_add_tags_to_items.py

# 3. マイグレーションを適用
docker compose exec backend alembic upgrade head

# その他のコマンド
docker compose exec backend alembic history     # 履歴確認
docker compose exec backend alembic current     # 現在のリビジョン確認
docker compose exec backend alembic downgrade -1  # 1つ戻す
```

**新しいモデルを追加したときの手順**
1. `backend/models/新モデル.py` を作成
2. `backend/alembic/env.py` の末尾にインポートを追加:
   ```python
   import models.新モデル  # noqa: F401
   ```
3. `alembic revision --autogenerate` でマイグレーション生成
4. 生成ファイルを確認して `alembic upgrade head`

**autogenerate が検出できない変更（手動で書く必要がある）**
- カラム名の変更（削除→追加と誤認される）
- サーバーデフォルト値の変更
- カスタム型・制約の一部

### リトライ処理（`frontend/src/lib/fetch.ts`）

**すべての fetch 呼び出しは `fetch` ではなく `fetchWithRetry` を使うこと。**

```typescript
import { fetchWithRetry } from '@/lib/fetch'

// ✅ 正しい: リトライ付き
const res = await fetchWithRetry(
  `${API_URL}/api/items/`,
  { headers: { Authorization: `Bearer ${token}` } },
  {
    maxRetries: 3,
    // リトライ中に UI フィードバックを表示する場合
    onRetry: (attempt, max) => setRetryInfo({ attempt, max }),
  },
)

// ❌ 避ける: 素の fetch は使わない
const res = await fetch(`${API_URL}/api/items/`, { ... })
```

**リトライ対象の判断（Chapter 4 準拠）**
```
ネットワークエラー → リトライ ✅
5xx サーバーエラー → リトライ ✅
4xx クライアントエラー → リトライしない ❌（リクエストを直さないと解決しない）
```

**UI へのリトライフィードバック**
```tsx
{retryInfo && (
  <div>🔄 リトライ中...（{retryInfo.attempt} / {retryInfo.max} 回）</div>
)}
```

### SSE・WebSocket の認証パターン

**ブラウザの SSE/WebSocket API はカスタムヘッダーを送れない**ため、
どちらもチケット方式（POST で認証 → チケット取得 → URL に含める）を採用している。

```
SSE:
  POST /api/sse/tasks       Bearer 認証 → task_id 発行
  GET  /api/sse/tasks/{id}  task_id が暗黙の認証トークン

WebSocket:
  POST /api/ws/tickets      Bearer 認証 → ws_ticket 発行（60秒 TTL・一度きり）
  WS   /ws/{client_id}?ticket={ws_ticket}  チケットで接続
```

新しい SSE/WebSocket エンドポイントを追加する場合も、このチケット方式を踏襲すること。

**EventSource は Authorization ヘッダーを送れない**ため、以下のパターンを使用:

```python
# backend/routers/sse.py のパターン
# Step 1: POST で認証 → task_id 発行
@router.post("/tasks", status_code=201)
async def start_task(current_user: dict = Depends(get_current_user)):
    task_id = str(uuid.uuid4())[:8]
    _task_store[task_id] = current_user["sub"]  # 所有者を記録
    return {"task_id": task_id}

# Step 2: GET でストリーム（task_id が暗黙の認証トークン）
@router.get("/tasks/{task_id}")
async def stream_events(task_id: str):
    if task_id not in _task_store:
        raise HTTPException(404)
    return StreamingResponse(
        _generate(task_id),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},  # nginx バッファリング無効化
    )
```

```typescript
// frontend のパターン
// Step 1: POST で task_id 取得（Bearer 認証）
const res = await fetch(`${API_URL}/api/sse/tasks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.accessToken}` },
})
const { task_id } = await res.json()

// Step 2: EventSource で購読（認証不要 - task_id が代替）
const es = new EventSource(`${API_URL}/api/sse/tasks/${task_id}`)
es.addEventListener('status',   (e) => { /* 進捗処理 */ })
es.addEventListener('complete', (e) => { es.close() })
```

**SSE エンドポイントを nginx に追加する場合**
```nginx
# /api/ より前に定義すること（より具体的なパスを先に評価）
location /api/sse/ {
    proxy_pass       http://backend;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering  off;   # 必須: バッファリングを無効化
    proxy_cache      off;
    proxy_read_timeout 300s;
}
```

---

## セキュリティヘッダー（nginx.conf）

以下のヘッダーが全レスポンスに付与されています（変更・削除しないこと）:

| ヘッダー | 目的 |
|---|---|
| `X-Frame-Options: DENY` | クリックジャッキング防止 |
| `X-Content-Type-Options: nosniff` | MIME スニッフィング防止 |
| `Referrer-Policy` | リファラー情報の制御 |
| `Permissions-Policy` | 不要なブラウザ機能の無効化 |
| `Content-Security-Policy` | XSS・インジェクション対策 |

**CSP を変更する場合の注意**
- `connect-src 'self'` は WebSocket・SSE・fetch の同一オリジン接続を許可
- `http://localhost:8080` は Keycloak 認証フローに必要
- 本番では `unsafe-inline` / `unsafe-eval` を削除し nonce 方式に変更

---

## 認証フロー（変更禁止ゾーン）

以下のファイルは認証の核となるため**変更しないこと**:
- `frontend/src/lib/auth.ts` — NextAuth + Keycloak 接続設定
- `frontend/src/app/api/auth/[...nextauth]/route.ts` — NextAuth ルートハンドラ
- `backend/auth.py` — JWT 検証ロジック

---

## 環境変数

| 変数名 | 用途 |
|---|---|
| `KEYCLOAK_ISSUER` | トークン `iss` 検証・ブラウザリダイレクト先 |
| `KEYCLOAK_INTERNAL_URL` | サーバーサイドの Keycloak API 呼び出し先 |
| `NEXT_PUBLIC_API_URL` | クライアントサイドの API ベース URL |
| `NEXT_PUBLIC_WS_URL` | クライアントサイドの WebSocket ベース URL |

---

## 開発用ユーザー

| ユーザー名 | パスワード | ロール |
|---|---|---|
| `admin-user` | `password` | user, admin |
| `normal-user` | `password` | user |
| `disabled-user` | `password` | user（無効） |

---

## やってはいけないこと

- `backend/auth.py` の `get_current_user` を変更する
- `frontend/src/lib/auth.ts` を上書き変更する
- nginx の `/api/sse/` location を `/api/` の後ろに書く（SSE が動かなくなる）
- SSE の `StreamingResponse` に `proxy_buffering on` を設定する
- CSP の `frame-ancestors` を削除する（クリックジャッキング対策が無効になる）
- `docker compose down -v` を確認なしに実行する（全データが消える）

---

## 参考

本プロジェクトは O'Reilly「Fluent Web Development」の設計原則に基づいています。

| 実装箇所 | 対応する章 |
|---|---|
| HTTP メソッド・ステータスコード（`items.py`） | Chapter 4 |
| WebSocket ブロードキャスト（`ws.py`） | Chapter 4 |
| SSE 進捗通知（`sse.py`、`SseDemo.tsx`） | Chapter 4 |
| セキュリティヘッダー（`nginx.conf`） | Chapter 4 |
| nginx による HTTP/2 終端・immutable キャッシュ | Chapter 4 |
| C4 モデルに基づくサービス分離 | Chapter 3 |
| Server Component での認証チェック | Chapter 5 |
| CSS レイヤー・変数・レイアウト分離 | Chapter 7 |
