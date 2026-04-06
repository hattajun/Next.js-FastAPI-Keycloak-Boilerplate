/**
 * fetchWithRetry — 指数バックオフ付きリトライ
 *
 * Chapter 4「Retry Strategies and Backoff」の TypeScript 実装。
 *
 * ── リトライ対象 ─────────────────────────────────────────────────────
 *   ✅ ネットワークエラー（接続失敗・DNS 解決失敗・タイムアウト）
 *   ✅ 5xx サーバーエラー（過負荷・一時的な障害）
 *
 * ── リトライしない ───────────────────────────────────────────────────
 *   ❌ 4xx クライアントエラー（リクエストを修正しないと解決しない）
 *      401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity …
 *
 * ── バックオフ戦略 ───────────────────────────────────────────────────
 *   指数バックオフ + ジッター（thundering herd 問題の回避）
 *
 *   attempt 0 失敗 → 1000ms ± jitter 待機 → attempt 1
 *   attempt 1 失敗 → 2000ms ± jitter 待機 → attempt 2
 *   attempt 2 失敗 → 4000ms ± jitter 待機 → attempt 3
 *   attempt 3 失敗 → lastError を throw
 *
 *   ジッターを加えることで、複数クライアントが同時にリトライしても
 *   サーバーへのリクエストが分散される。
 */

export interface RetryOptions {
  /** 最大リトライ回数（デフォルト: 3） */
  maxRetries?: number
  /** 基本待機時間 ms（デフォルト: 1000）指数バックオフのベース */
  baseDelay?: number
  /** ジッターの最大値 ms（デフォルト: 300）*/
  jitter?: number
  /**
   * リトライ直前に呼ばれるコールバック。
   * UI に「リトライ中...」を表示する際に使用する。
   */
  onRetry?: (attempt: number, maxRetries: number, error: Error) => void
}

/**
 * fetch をラップし、失敗時に指数バックオフでリトライする。
 *
 * @example
 * // 基本的な使い方
 * const res = await fetchWithRetry('/api/items/', {
 *   headers: { Authorization: `Bearer ${token}` }
 * })
 *
 * @example
 * // リトライ状態を UI に表示する
 * const res = await fetchWithRetry('/api/items/', options, {
 *   maxRetries: 3,
 *   onRetry: (attempt, max) => setRetryInfo({ attempt, max }),
 * })
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelay  = 1000,
    jitter     = 300,
    onRetry,
  } = retryOptions

  let lastError: Error = new Error('Unknown fetch error')

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)

      // 成功
      if (response.ok) return response

      // 4xx はリトライしない
      if (response.status >= 400 && response.status < 500) {
        const error = new Error(`${response.status} ${response.statusText}`)
        ;(error as FetchError).status = response.status
        ;(error as FetchError).response = response
        throw error
      }

      // 5xx はリトライ対象
      lastError = new Error(`Server error: ${response.status} ${response.statusText}`)
      ;(lastError as FetchError).status = response.status

    } catch (error) {
      if (error instanceof Error) {
        // 4xx（上で throw したもの）はリトライせずそのまま再スロー
        if ((error as FetchError).status !== undefined &&
            (error as FetchError).status! < 500) {
          throw error
        }
        lastError = error
      }
    }

    // 最後の試行ではバックオフを挟まない
    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * baseDelay + Math.random() * jitter
      onRetry?.(attempt + 1, maxRetries, lastError)
      await sleep(delay)
    }
  }

  throw lastError
}

// ── 型定義 ────────────────────────────────────────────────────────────────────

interface FetchError extends Error {
  status?: number
  response?: Response
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
