/**
 * fetchWithRetry のユニットテスト
 *
 * テスト戦略:
 *   - global.fetch を jest.fn() でモック（ネットワーク通信なし）
 *   - baseDelay: 0, jitter: 0 を渡して実際の待機をなくす
 *   - 各テストは beforeEach で fetch モックをリセット
 *
 * テスト環境: node（DOM 不要の純粋関数）
 */

import { fetchWithRetry } from '../fetch'

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/** 成功レスポンスのモックを生成する */
function mockSuccess(body: unknown = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response
}

/** エラーレスポンスのモックを生成する */
function mockError(status: number, statusText = 'Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
  } as Response
}

/** リトライを速くするためのオプション（実際の待機なし） */
const NO_DELAY = { baseDelay: 0, jitter: 0 } as const

// ── セットアップ ───────────────────────────────────────────────────────────────

beforeEach(() => {
  // 各テスト前に fetch モックをリセット
  global.fetch = jest.fn()
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── 正常系 ────────────────────────────────────────────────────────────────────

describe('正常系', () => {
  test('200 OK のレスポンスをそのまま返す', async () => {
    const mockRes = mockSuccess({ id: 1, name: 'Test' })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockRes)

    const res = await fetchWithRetry('/api/items/')
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ id: 1, name: 'Test' })
  })

  test('成功時は fetch を1回だけ呼ぶ', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, NO_DELAY)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('指定した URL と options が fetch に渡される', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockSuccess())

    const options: RequestInit = {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    }
    await fetchWithRetry('/api/items/', options, NO_DELAY)

    expect(global.fetch).toHaveBeenCalledWith('/api/items/', options)
  })
})

// ── 5xx リトライ ───────────────────────────────────────────────────────────────

describe('5xx エラー — リトライする', () => {
  test('503 → 成功 の場合、成功レスポンスを返す', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockError(503, 'Service Unavailable'))
      .mockResolvedValueOnce(mockSuccess())

    const res = await fetchWithRetry('/api/items/', {}, NO_DELAY)
    expect(res.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('全試行で 500 の場合、エラーをスローする', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(mockError(500, 'Internal Server Error'))

    await expect(
      fetchWithRetry('/api/items/', {}, { ...NO_DELAY, maxRetries: 3 })
    ).rejects.toThrow('Internal Server Error')

    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  test('maxRetries: 2 の場合、2回だけ試行する', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(mockError(502, 'Bad Gateway'))

    await expect(
      fetchWithRetry('/api/items/', {}, { ...NO_DELAY, maxRetries: 2 })
    ).rejects.toThrow()

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('デフォルト maxRetries は 3', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(mockError(503))

    await expect(
      fetchWithRetry('/api/items/', {}, NO_DELAY)
    ).rejects.toThrow()

    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  test.each([500, 502, 503, 504])(
    'ステータス %i はリトライする',
    async (status) => {
      ;(global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockError(status))
        .mockResolvedValueOnce(mockSuccess())

      const res = await fetchWithRetry('/api/items/', {}, NO_DELAY)
      expect(res.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    }
  )
})

// ── 4xx エラー — リトライしない ───────────────────────────────────────────────

describe('4xx エラー — リトライしない', () => {
  test('404 は即座にエラーをスローする', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockError(404, 'Not Found'))

    await expect(
      fetchWithRetry('/api/items/999', {}, NO_DELAY)
    ).rejects.toThrow('Not Found')

    // リトライしないので1回だけ
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test.each([400, 401, 403, 404, 409, 422, 429])(
    'ステータス %i はリトライしない',
    async (status) => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockError(status))

      await expect(
        fetchWithRetry('/api/items/', {}, NO_DELAY)
      ).rejects.toThrow()

      expect(global.fetch).toHaveBeenCalledTimes(1)
    }
  )

  test('4xx の後に成功レスポンスを返さない', async () => {
    // 4xx の後に 200 をモックしても、4xx でスローされるためリトライされない
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockError(401, 'Unauthorized'))
      .mockResolvedValueOnce(mockSuccess())

    await expect(
      fetchWithRetry('/api/items/', {}, NO_DELAY)
    ).rejects.toThrow('Unauthorized')

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

// ── ネットワークエラー ─────────────────────────────────────────────────────────

describe('ネットワークエラー — リトライする', () => {
  test('fetch が reject した場合にリトライする', async () => {
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockSuccess())

    const res = await fetchWithRetry('/api/items/', {}, NO_DELAY)
    expect(res.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('全試行でネットワークエラーの場合、エラーをスローする', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(
      new TypeError('Failed to fetch')
    )

    await expect(
      fetchWithRetry('/api/items/', {}, { ...NO_DELAY, maxRetries: 3 })
    ).rejects.toThrow('Failed to fetch')

    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  test('DNS 解決失敗もリトライする', async () => {
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))
      .mockResolvedValueOnce(mockSuccess())

    const res = await fetchWithRetry('/api/items/', {}, NO_DELAY)
    expect(res.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})

// ── onRetry コールバック ───────────────────────────────────────────────────────

describe('onRetry コールバック', () => {
  test('リトライ時に onRetry が呼ばれる', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockError(503))
      .mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, { ...NO_DELAY, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('onRetry に attempt・max・error が渡される', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockError(503, 'Service Unavailable'))
      .mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, {
      ...NO_DELAY,
      maxRetries: 3,
      onRetry,
    })

    expect(onRetry).toHaveBeenCalledWith(
      1,              // attempt（1回目のリトライ）
      3,              // maxRetries
      expect.any(Error)  // エラーオブジェクト
    )
  })

  test('複数回リトライした場合、onRetry の attempt が正しく増える', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockError(503))
      .mockResolvedValueOnce(mockError(503))
      .mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, {
      ...NO_DELAY,
      maxRetries: 3,
      onRetry,
    })

    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, expect.any(Error))
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, expect.any(Error))
  })

  test('成功時は onRetry が呼ばれない', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, { ...NO_DELAY, onRetry })
    expect(onRetry).not.toHaveBeenCalled()
  })

  test('4xx エラー時は onRetry が呼ばれない', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockError(404))

    await expect(
      fetchWithRetry('/api/items/', {}, { ...NO_DELAY, onRetry })
    ).rejects.toThrow()

    expect(onRetry).not.toHaveBeenCalled()
  })
})

// ── オプション ────────────────────────────────────────────────────────────────

describe('RetryOptions', () => {
  test('maxRetries: 1 の場合、1回だけ試行する', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(mockError(503))

    await expect(
      fetchWithRetry('/api/items/', {}, { ...NO_DELAY, maxRetries: 1 })
    ).rejects.toThrow()

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('最初の試行で成功すれば onRetry は呼ばれない', async () => {
    const onRetry = jest.fn()
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(mockSuccess())

    await fetchWithRetry('/api/items/', {}, { maxRetries: 5, baseDelay: 0, jitter: 0, onRetry })
    expect(onRetry).not.toHaveBeenCalled()
  })
})
