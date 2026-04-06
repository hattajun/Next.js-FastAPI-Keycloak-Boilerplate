# Next.js + FastAPI + Keycloak Boilerplate

フルスタックWebアプリケーションのボイラープレートです。

## スタック

| レイヤー | 技術 |
|---|---|
| リバースプロキシ | nginx 1.25 |
| フロントエンド | Next.js 14 (App Router) + TypeScript |
| バックエンド | FastAPI + Python 3.12 |
| データベース | PostgreSQL 16 |
| 認証 | Keycloak 23 (OpenID Connect / SSO) |
| 実行環境 | Docker + docker-compose |

---

## ディレクトリ構成

```
boilerplate/
├── docker-compose.yml                       # 開発用（デフォルト）
├── docker-compose.prod.yml                  # 本番用
├── .env.example
├── .gitignore
├── nginx/
│   └── nginx.conf                           # リバースプロキシ設定
├── frontend/
│   ├── Dockerfile                           # 開発用（next dev / inspector 有効）
│   ├── Dockerfile.prod                      # 本番用（マルチステージ）
│   ├── package.json
│   ├── next.config.mjs
│   └── src/
│       ├── app/
│       │   ├── layout.tsx                   # ルートレイアウト
│       │   ├── page.tsx                     # ランディングページ（公開）
│       │   ├── globals.css                  # ベーススタイル（CSS レイヤー）
│       │   ├── dashboard/
│       │   │   ├── page.tsx                 # ダッシュボード概要（要認証）
│       │   │   ├── rest-api/page.tsx        # REST API デモ
│       │   │   ├── websocket/page.tsx       # WebSocket デモ
│       │   │   └── sse/page.tsx             # SSE デモ
│       │   └── api/auth/[...nextauth]/route.ts
│       ├── components/
│       │   ├── Providers.tsx                # SessionProvider ラッパー
│       │   ├── NavBar.tsx                   # ナビゲーション（サブタブ付き）
│       │   ├── RestApiDemo.tsx              # REST CRUD デモコンポーネント
│       │   ├── WebSocketDemo.tsx            # WebSocket チャットデモコンポーネント
│       │   └── SseDemo.tsx                  # SSE 進捗デモコンポーネント
│       ├── lib/
│       │   ├── auth.ts                      # NextAuth + Keycloak 設定
│       │   └── fetch.ts                     # fetchWithRetry ユーティリティ
│       └── types/
│           └── next-auth.d.ts               # Session 型拡張
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh                        # 本番用（--reload なし・debugpy なし）
│   ├── entrypoint.dev.sh                    # 開発用（--reload あり・debugpy :5678）
│   ├── requirements.txt
│   ├── requirements-dev.txt                 # pytest / debugpy（開発専用）
│   ├── alembic.ini                          # Alembic 設定
│   ├── alembic/
│   │   ├── env.py                           # マイグレーション環境設定
│   │   ├── script.py.mako                   # マイグレーションファイルのテンプレート
│   │   └── versions/                        # マイグレーションファイル群
│   ├── main.py                              # FastAPI エントリーポイント
│   ├── database.py                          # SQLAlchemy (async) / 設定
│   ├── auth.py                              # Keycloak JWKS によるJWT検証
│   ├── models/
│   │   └── item.py                          # ORM モデル
│   └── routers/
│       ├── items.py                         # REST CRUD エンドポイント
│       ├── ws.py                            # WebSocket エンドポイント
│       └── sse.py                           # SSE エンドポイント
└── keycloak/
    ├── realm-export.json                    # レルム・ユーザー初期設定（自動インポート）
    └── scripts/
        └── create-users.sh                  # Admin REST API でユーザーを追加するスクリプト
```

---

### テスト

#### Phase 1: バックエンド統合テスト

テストはバックエンドコンテナ内で実行します。PostgreSQL と Alembic マイグレーションが必要なため、`docker compose up` でコンテナを起動してから実行してください。

```bash
# 全テスト
docker compose exec backend pytest

# slow マーカーを除いた高速実行（約4秒かかる SSE ストリームテストを除く）
docker compose exec backend pytest -m "not slow"

# カバレッジ付き
docker compose exec backend pytest --cov=. --cov-report=term-missing
```

| ファイル | 内容 |
|---|---|
| `tests/test_items.py` | CRUD 全パターン（正常系・404・422・403・他ユーザー越権）|
| `tests/test_sse.py` | SSE エンドポイント（task_id発行・404・content-type）|
| `tests/test_migrations.py` | マイグレーションファイルの静的チェック（DB変更なし）|

**多ユーザーテストの方針:** 他ユーザーのデータは HTTP 経由ではなく SQLAlchemy で直接 DB に挿入します（`conftest.py` の `db_session` フィクスチャを使用）。

#### Phase 2: フロントエンド単体テスト

フロントエンドの単体テストは **ローカル** で実行します（Docker 不要）。

```bash
cd frontend
npm install           # 初回のみ
npm test              # 全テスト（watch なし）
npm run test:watch    # ファイル変更を検知して自動再実行
npm run test:coverage # カバレッジ付き（80% を目標）
```

| ファイル | 対象 | テスト数 |
|---|---|---|
| `src/lib/__tests__/fetch.test.ts` | `fetchWithRetry` の全パターン | 約30件 |

**テスト設計のポイント:**
- `global.fetch` を `jest.fn()` でモック（実際のネットワーク通信なし）
- `baseDelay: 0, jitter: 0` を渡して待機時間ゼロで高速実行
- `jest-environment-node`（DOM 不要の純粋関数につき jsdom より高速）

**テストケース一覧:**

| グループ | 内容 |
|---|---|
| 正常系 | 1回目成功・options の透過・レスポンスの返却 |
| 5xx リトライ | 500/502/503/504 でリトライ・maxRetries 後にエラー |
| 4xx 非リトライ | 400/401/403/404/422/429 は即スロー・1回のみ呼ばれる |
| ネットワークエラー | TypeError / DNS エラーでリトライ |
| onRetry コールバック | attempt番号・maxRetries・Error の検証 |
| オプション | maxRetries カスタム設定 |

**DB 分離（バックエンド）:** 各テストはトランザクション内で実行され、テスト後にロールバックされます。テスト間の状態汚染はありません。

#### Phase 3: GitHub Actions CI（このboilerplateには含まれません）

Phase 3 はチーム開発において Phase 1・2 を自動化するものです。このboilerplateでは含めていませんが、実際のプロジェクトに移行する際に追加することを推奨します。

**概要:** プッシュ・プルリクエスト時に Phase 1・2 のテストを自動実行します。

**実装する場合の構成例（`.github/workflows/test.yml`）:**

```yaml
name: Tests
on: [push, pull_request]

jobs:
  # ── バックエンド（pytest）────────────────────────────────
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: appdb
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt -r requirements-dev.txt
        working-directory: backend
      - run: alembic upgrade head
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/appdb
      - run: pytest -m "not slow" --cov=. --cov-report=xml
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/appdb

  # ── フロントエンド（Jest）──────────────────────────────
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
        working-directory: frontend
      - run: npm test
        working-directory: frontend
```

**検討ポイント:**
- `slow` マーカーの SSE ストリームテストは CI では除外し、定期実行（`schedule`）で実施するとよい
- カバレッジレポートは Codecov 等と連携することで PR 上に差分表示できる
- Keycloak を CI に含めると起動に2分以上かかるため、認証のテストは JWT 検証のモックで代替する

---

#### Phase 4: E2E テスト — Playwright（このboilerplateには含まれません）

Phase 4 はユーザーの実際の操作フローをブラウザを介してテストするものです。設定コストが高いため、このboilerplateでは含めていませんが、重要なユーザーフローを保護したい場合に追加します。

**対象フロー（最小限の推奨セット）:**

| テスト | 内容 | 優先度 |
|---|---|---|
| ログインフロー | トップページ → Keycloak → ダッシュボードへのリダイレクト | 高 |
| アイテム作成 | フォーム入力 → 送信 → 一覧に表示される | 高 |
| 未認証リダイレクト | `/dashboard` に直接アクセス → トップページへリダイレクト | 中 |
| WebSocket 疎通 | 接続 → メッセージ送信 → 受信表示 | 低 |

**実装する場合の構成例:**

```
e2e/
├── playwright.config.ts    # ベースURL・ブラウザ設定
├── fixtures/
│   └── auth.ts             # ログイン済みページのフィクスチャ
└── tests/
    ├── auth.spec.ts        # ログインフロー
    └── items.spec.ts       # アイテム CRUD
```

**Keycloak ログインの扱い:**

Keycloak のログインフォームを Playwright で操作するには `page.fill()` でユーザー名・パスワードを入力する方法が使えます。ただし以下の点に注意が必要です。

```typescript
// e2e/fixtures/auth.ts
export async function loginAsTestUser(page: Page) {
  await page.goto('http://localhost')
  await page.click('button:has-text("Sign in")')
  // Keycloak のログインフォーム
  await page.fill('#username', 'normal-user')
  await page.fill('#password', 'password')
  await page.click('[type="submit"]')
  await page.waitForURL('**/dashboard/**')
}
```

**検討ポイント:**
- E2E はすべてのサービスを起動した状態（`docker compose up`）で実行するため CI 時間が大幅に伸びる。`main` ブランチへのマージ時のみ実行する設定が現実的
- Keycloak の起動に時間がかかるため、`wait-on` や `docker compose wait` で起動確認を挟む
- テストデータは毎回 Keycloak の `create-users.sh` と Alembic の `downgrade base && upgrade head` でリセットする
- ブラウザの言語設定や画面サイズが Keycloak の UI に影響することがある（`playwright.config.ts` で固定する）

---

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env
# 開発環境はデフォルト値のままで動作します
```

### 2. 起動

#### 開発環境（通常）

```bash
docker compose up --build
```

`docker-compose.yml`（開発用）を使用します。以下の機能が有効です：

- **backend**: `entrypoint.dev.sh` で起動（debugpy :5678・uvicorn `--reload`）
- **frontend**: `next dev`（HMR・Node.js inspector :9229）
- **コードマウント**: ホストのファイル変更がコンテナに即時反映
- **デバッグ**: VSCode から「Full Stack: attach to Docker containers」でアタッチ可能

#### 本番環境の動作確認

```bash
docker compose -f docker-compose.prod.yml up --build
```

`docker-compose.prod.yml`（本番用）を使用します：

- **backend**: `entrypoint.sh` で起動（`--reload` なし・debugpy なし）
- **frontend**: `next build → next start`（マルチステージビルド）
- **コードマウントなし**: コードはイメージに焼き込まれる

> **本番環境として公開する前に**「本番環境に向けた TODO」を必ず確認してください。

#### 開発環境と本番環境の比較

| 項目 | 開発 | 本番 |
|---|---|---|
| 起動コマンド | `docker compose up --build` | `docker compose -f docker-compose.prod.yml up --build` |
| backend entrypoint | `entrypoint.dev.sh` | `entrypoint.sh` |
| uvicorn `--reload` | ✅ あり | ❌ なし |
| debugpy（:5678） | ✅ あり | ❌ なし |
| Node.js inspector（:9229） | ✅ あり | ❌ なし |
| コードマウント | ✅ ホスト→コンテナ | ❌ イメージに焼き込み |
| requirements-dev.txt | ✅ インストール | ❌ スキップ |
| frontend Dockerfile | `Dockerfile` | `Dockerfile.prod` |

初回起動時は Keycloak のデータベース初期化に **1〜2分** かかります。

> **再起動時の注意**
> `keycloak/realm-export.json` や docker-compose の Keycloak 設定を変更した場合は、
> 既存のボリュームを削除してから再起動してください。
> ```bash
> # 開発環境
> docker compose down -v && docker compose up --build
>
> # 本番環境
> docker compose -f docker-compose.prod.yml down -v
> docker compose -f docker-compose.prod.yml up --build
> ```

### 3. アクセス先

| サービス | URL | 備考 |
|---|---|---|
| **アプリ（nginx 経由）** | **http://localhost** | メインエントリーポイント |
| フロントエンド（直接） | http://localhost:3000 | デバッグ用 |
| FastAPI Swagger UI | http://localhost:8000/docs | デバッグ用 |
| Keycloak 管理コンソール | http://localhost:8080 | ユーザー名: `admin` / パスワード: `admin` |

### 4. 開発用ユーザー

`keycloak/realm-export.json` で以下のユーザーが起動時に自動作成されます。

| ユーザー名 | メール | パスワード | ロール | 用途 |
|---|---|---|---|---|
| `admin-user` | admin@example.com | `password` | user + admin | 管理者権限の動作確認 |
| `normal-user` | user@example.com | `password` | user | 一般ユーザーの動作確認 |
| `disabled-user` | disabled@example.com | `password` | user | 無効ユーザーの挙動確認（ログイン不可） |

> **セキュリティ上の注意**
> `realm-export.json` にはパスワードが平文で含まれます。
> パブリックリポジトリへの公開やステージング・本番環境での使用は避けてください。

### データベースマイグレーション（Alembic）

コンテナ起動時に `entrypoint.sh` が自動で `alembic upgrade head` を実行します。

```bash
# モデルを変更したら差分マイグレーションを生成
docker compose exec backend alembic revision --autogenerate -m "add_tags_to_items"

# 生成ファイルを確認してから適用
docker compose exec backend alembic upgrade head

# 1つ前のバージョンに戻す
docker compose exec backend alembic downgrade -1

# 履歴・現在のリビジョン確認
docker compose exec backend alembic history
docker compose exec backend alembic current
```

> VSCode の場合は `Ctrl+Shift+P` → "Tasks: Run Task" → `alembic:` から実行できます。

**新しいモデルを追加したときの手順**
1. `backend/models/` にモデルファイルを作成
2. `backend/alembic/env.py` に `import models.新モデル` を追記
3. `alembic revision --autogenerate` でマイグレーション生成
4. 生成されたファイルを確認・修正してから `alembic upgrade head`

---

## 主な機能

### nginx ルーティング

nginx がシングルエントリーポイントとして全トラフィックを振り分けます。

```
ブラウザ :80
    │
    ├─ /ws/               → backend:8000  (WebSocket)
    ├─ /api/sse/          → backend:8000  (SSE — バッファリング無効)
    ├─ /api/auth/         → frontend:3000 (NextAuth コールバック)
    ├─ /api/              → backend:8000  (FastAPI REST)
    ├─ /_next/static/     → frontend:3000 (immutable キャッシュ付き)
    ├─ /_next/webpack-hmr → frontend:3000 (開発用 HMR WebSocket)
    └─ /                  → frontend:3000 (その他すべて)
```

`/_next/static/` 配下のファイルはビルド時にコンテンツハッシュがファイル名に付与されるため、
nginx が `Cache-Control: max-age=31536000, immutable` を設定しても安全です。

### セキュリティヘッダー（Chapter 4）

nginx で以下のヘッダーを全レスポンスに付与しています。

| ヘッダー | 設定値 | 効果 |
|---|---|---|
| `X-Frame-Options` | `DENY` | クリックジャッキング防止 |
| `X-Content-Type-Options` | `nosniff` | MIME スニッフィング防止 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | リファラー情報の制御 |
| `Permissions-Policy` | カメラ等を無効化 | 不要なブラウザ機能を制限 |
| `Content-Security-Policy` | `default-src 'self'` ベース | XSS・インジェクション対策 |

> **本番環境での注意**
> CSP の `unsafe-inline` / `unsafe-eval` は Next.js の開発モード（HMR）に必要ですが、
> 本番ビルドでは nonce ベースに変更して削除してください。
> `Strict-Transport-Security` は HTTPS 環境でのみ有効化してください。

### リトライ処理（`frontend/src/lib/fetch.ts`）

Chapter 4「Retry Strategies and Backoff」の実装です。全 API 呼び出しは素の `fetch` の代わりに `fetchWithRetry` を使用しています。

```
ネットワークエラー・5xx → 指数バックオフでリトライ（最大3回）
4xx クライアントエラー  → リトライしない（リクエスト側の問題）
```

**バックオフスケジュール（ジッター付き）**

| 試行 | 待機時間 |
|---|---|
| 1回目失敗 | 1000ms ± ランダムジッター |
| 2回目失敗 | 2000ms ± ランダムジッター |
| 3回目失敗 | 4000ms ± ランダムジッター |

ジッターを加えることで、複数クライアントが同時にリトライした際にサーバーへのリクエストが分散されます（thundering herd 問題の回避）。

### REST API (FastAPI)

`/api/items/` に認証付きの CRUD エンドポイントがあります。

```
GET    /api/items/        ログインユーザーのアイテム一覧
POST   /api/items/        アイテム作成 (201 Created)
GET    /api/items/{id}    アイテム取得
DELETE /api/items/{id}    アイテム削除 (204 No Content)
```

- すべてのエンドポイントは `Authorization: Bearer <token>` を要求します。
- Keycloak の JWKS エンドポイントでトークンを検証します。
- 各ユーザーは自分のアイテムのみ参照・操作できます。

### WebSocket (`/ws/{client_id}`)

- 接続した全クライアントへのブロードキャストチャットです。
- JSON フォーマット: `{ "message": "Hello" }`
- ブラウザを複数タブで開いて動作を確認できます。

### SSE (`/api/sse/tasks`)

Server-Sent Events による一方向リアルタイム通信のサンプルです。

```
POST /api/sse/tasks          タスク開始（Bearer 認証）→ task_id を返す
GET  /api/sse/tasks/{task_id} EventSource で進捗イベントを購読
```

EventSource は Authorization ヘッダーを送れないため、
POST でタスクを開始して `task_id` を取得し、その `task_id` を
URL に含めることで認証を代替しています（Chapter 4 の SSE パターン準拠）。

| | SSE | WebSocket |
|---|---|---|
| 通信方向 | サーバー→クライアント（一方向） | 双方向 |
| 向いている用途 | 進捗通知・ログ・AI応答 | チャット・ゲーム |
| 自動再接続 | ブラウザ標準で対応 | 実装が必要 |

### Keycloak SSO

- `keycloak/realm-export.json` が起動時に自動インポートされます。
- Next.js は `next-auth` + `KeycloakProvider` で認証します。
- FastAPI は Keycloak の JWKS を使って Bearer トークンを検証します。

#### Keycloak URL の仕組み（WSL2 Native Docker 対応）

Docker 環境では Next.js コンテナとブラウザが異なるネットワークにいるため、
Keycloak への接続に 2 種類の URL を使い分けています。

| 環境変数 | 値 | 用途 |
|---|---|---|
| `KEYCLOAK_ISSUER` | `http://localhost:8080/realms/myrealm` | トークンの `iss` 検証・ブラウザ認証リダイレクト先 |
| `KEYCLOAK_INTERNAL_URL` | `http://keycloak:8080/realms/myrealm` | サーバーサイドの API 呼び出し（コンテナ内部） |
| `KC_HOSTNAME_URL` | `http://localhost:8080` | Keycloak が生成する全 URL のベース（`iss` クレームに反映） |

`KC_HOSTNAME_URL` を設定することで Keycloak が返すすべての URL（トークンの `iss`、
Discovery Document の各エンドポイント）が `localhost:8080` ベースになり、
ブラウザからの認証フローが正常に動作します。

#### 認証チェックの二重構造

`/dashboard` 配下のページは、サーバーサイドとクライアントサイドの両方でセッションを検証しています。

| タイミング | 実装箇所 | 対象ケース |
|---|---|---|
| ページ初回ロード時 | `dashboard/*/page.tsx`（サーバーコンポーネント）の `getServerSession` | 未ログインでの直接アクセス |
| ページ表示中のセッション失効 | `NavBar.tsx` の `useEffect`（クライアントコンポーネント） | JWT 期限切れ・別タブからのログアウト |

```
ページロード時
  └─ getServerSession → セッションなし → redirect('/')  （サーバーサイド）

ページ表示中
  └─ useSession の status が 'unauthenticated' に変化
       └─ pathname が /dashboard/* ならば router.push('/')  （NavBar.tsx）
```

**なぜ NavBar に実装するのか:** NavBar はすべてのページで描画されるクライアントコンポーネントで、すでに `useSession` と `usePathname` を保持しています。ここで一元管理することで、新しいデモページを追加しても自動的に同じ保護が適用されます。

#### ユーザーをスクリプトで追加する

起動後に Admin REST API 経由でユーザーを追加したい場合:

```bash
docker compose exec keycloak bash /opt/keycloak/data/import/scripts/create-users.sh
```

`keycloak/scripts/create-users.sh` 内の `create_user` 行を追記するだけで
任意のユーザーを追加できます。既存ユーザーはスキップされるため冪等に実行できます。

---

## 本番環境に向けた TODO

`docker-compose.prod.yml` は本番構成の出発点ですが、公開前に以下を対応してください。

- [ ] `NEXTAUTH_SECRET` を強力なランダム値に変更する（`openssl rand -base64 32`）
- [ ] `KEYCLOAK_ADMIN_PASSWORD` を変更する
- [ ] `KEYCLOAK_CLIENT_SECRET` を変更する
- [ ] DB パスワード（`POSTGRES_PASSWORD`）を変更する
- [ ] `KC_HOSTNAME_URL` を本番ドメインに変更する（例: `https://example.com`）
- [ ] `KEYCLOAK_ISSUER` / `NEXT_PUBLIC_API_URL` を本番ドメインに合わせる
- [ ] `nginx/nginx.conf` に TLS 設定（`listen 443 ssl http2` + `ssl_certificate`）を追加する
- [ ] `docker-compose.prod.yml` で frontend・backend・keycloak の `ports:` を削除し nginx のみ公開する
- [ ] Keycloak の `command: start-dev` を `start` に変更する（本番モード）
- [ ] Keycloak の `sslRequired` を `"external"` に変更する
- [ ] 本番では entrypoint.sh の複数インスタンス起動時の競合対策を検討する（Alembic マイグレーションの冪等実行）
- [ ] `docker-compose.prod.yml` に `mem_limit` / `cpus` でリソース制限を追加する

---

## 本書（Fluent Web Development）との対応

| 本書の章 | 本ボイラープレートへの反映箇所 |
|---|---|
| Chapter 2: Tooling | Next.js 内蔵ビルドシステム採用（Vite/Webpack を個別管理しない） |
| Chapter 3: Architecture | C4モデルに基づいた nginx / Frontend / Backend / DB / Auth の分離 |
| Chapter 4: Networking | HTTP メソッド・ステータスコード（`items.py`）、WebSocket（`ws.py`）、SSE（`sse.py`）、セキュリティヘッダー（`nginx.conf`）、fetchWithRetry（`fetch.ts`）、nginx による immutable キャッシュ |
| Chapter 5: Rendering | Server Component でのサーバーサイド認証チェック（`dashboard/*/page.tsx`） |
| Chapter 7: Robust CSS | CSS レイヤー・CSS 変数によるベーススタイル（`globals.css`）、レイアウトとコンポーネントの分離 |
