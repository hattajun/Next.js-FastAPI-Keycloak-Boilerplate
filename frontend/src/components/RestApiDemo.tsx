'use client'

/**
 * REST API デモ
 *
 * Chapter 4 の HTTP 規約（メソッド・ステータスコード）と
 * 「Retry Strategies and Backoff」を組み合わせた実装サンプル。
 *
 * fetchWithRetry を使用することで:
 *   - ネットワーク瞬断・5xx エラー時に指数バックオフでリトライ
 *   - 4xx（認証エラー・バリデーションエラー等）はリトライしない
 *   - リトライ中は UI にフィードバックを表示
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { fetchWithRetry } from '@/lib/fetch'

interface Item {
  id: number
  name: string
  description: string | null
  owner_id: string
  created_at: string
}

interface PaginatedItems {
  items: Item[]
  total: number
}

interface RetryInfo {
  attempt: number
  max: number
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost'
const PAGE_SIZE_OPTIONS = [5, 10, 100] as const

export default function RestApiDemo() {
  const { data: session } = useSession()
  const [items, setItems]         = useState<Item[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [pageSize, setPageSize]   = useState<number>(10)
  const [name, setName]           = useState('')
  const [description, setDesc]    = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // ── 共通ヘッダー ──────────────────────────────────────────────────
  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.accessToken ?? ''}`,
  }), [session?.accessToken])

  // ── リトライコールバック（UI フィードバック用）──────────────────
  const onRetry = useCallback((attempt: number, max: number) => {
    setRetryInfo({ attempt, max })
  }, [])

  // ── アイテム一覧取得 ───────────────────────────────────────────
  const fetchItems = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true)
    setError(null)
    setRetryInfo(null)
    try {
      const skip = targetPage * targetPageSize
      const res = await fetchWithRetry(
        `${API_URL}/api/items/?skip=${skip}&limit=${targetPageSize}`,
        { headers: authHeaders() },
        { onRetry },
      )
      const data: PaginatedItems = await res.json()
      setItems(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      setRetryInfo(null)
    }
  }, [authHeaders, onRetry, page, pageSize])

  useEffect(() => {
    if (session?.accessToken) fetchItems()
  }, [session?.accessToken, fetchItems])

  // ── アイテム作成 ────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setRetryInfo(null)
    try {
      await fetchWithRetry(
        `${API_URL}/api/items/`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
        },
        { onRetry },
      )
      setName('')
      setDesc('')
      // 作成後は1ページ目へ戻る
      const newPage = 0
      setPage(newPage)
      await fetchItems(newPage, pageSize)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setRetryInfo(null)
    }
  }

  // ── アイテム削除 ────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    setError(null)
    setRetryInfo(null)
    try {
      const res = await fetchWithRetry(
        `${API_URL}/api/items/${id}`,
        { method: 'DELETE', headers: authHeaders() },
        { onRetry },
      )
      if (res.status !== 204) throw new Error(`Unexpected status: ${res.status}`)
      // 削除後、現在ページが空になった場合は前のページへ
      const newTotal = total - 1
      const newTotalPages = Math.max(1, Math.ceil(newTotal / pageSize))
      const newPage = Math.min(page, newTotalPages - 1)
      setPage(newPage)
      await fetchItems(newPage, pageSize)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setRetryInfo(null)
    }
  }

  // ── ページ変更 ─────────────────────────────────────────────────
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchItems(newPage, pageSize)
  }

  // ── 件数変更 ───────────────────────────────────────────────────
  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(0)
    fetchItems(0, newSize)
  }

  return (
    <section style={card}>
      <h2 style={{ marginBottom: 'var(--spacing-md)' }}>REST API — Items</h2>

      {/* ── 作成フォーム ─────────────────────────────────────────── */}
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="アイテム名 *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="説明（任意）"
          value={description}
          onChange={(e) => setDesc(e.target.value)}
          style={{ ...inputStyle, flexGrow: 2 }}
        />
        <button type="submit" style={primaryBtn}>追加</button>
      </form>

      {/* ── リトライ中インジケーター ─────────────────────────────── */}
      {retryInfo && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-xs)',
          fontSize: '0.8rem',
          color: '#d97706',
          marginBottom: 'var(--spacing-sm)',
          padding: 'var(--spacing-xs) var(--spacing-sm)',
          backgroundColor: '#fffbeb',
          border: '1px solid #fcd34d',
          borderRadius: 'var(--radius-md)',
        }}>
          <span>🔄</span>
          <span>
            ネットワークエラーが発生しました。リトライ中...（{retryInfo.attempt} / {retryInfo.max} 回）
          </span>
        </div>
      )}

      {/* ── エラー ───────────────────────────────────────────────── */}
      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>
          ⚠️ {error}
        </p>
      )}

      {/* ── ページサイズ選択 + 件数表示 ──────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)', flexWrap: 'wrap', gap: 'var(--spacing-xs)' }}>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          全 {total} 件
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>表示件数:</span>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              onClick={() => handlePageSizeChange(size)}
              style={pageSize === size ? pageSizeBtnActive : pageSizeBtn}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* ── アイテム一覧 ─────────────────────────────────────────── */}
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>読み込み中...</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>アイテムがありません。上のフォームから追加してください。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
          {items.map((item) => (
            <li key={item.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-bg-subtle)',
            }}>
              <div>
                <span style={{ fontWeight: 500 }}>{item.name}</span>
                {item.description && (
                  <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                    — {item.description}
                  </span>
                )}
              </div>
              <button onClick={() => handleDelete(item.id)} style={dangerBtn} aria-label={`Delete ${item.name}`}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── ページネーションコントロール ──────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-md)' }}>
          <button
            onClick={() => handlePageChange(0)}
            disabled={page === 0}
            style={page === 0 ? paginationBtnDisabled : paginationBtn}
            aria-label="最初のページ"
          >
            «
          </button>
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 0}
            style={page === 0 ? paginationBtnDisabled : paginationBtn}
            aria-label="前のページ"
          >
            ‹
          </button>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', minWidth: '6rem', textAlign: 'center' }}>
            {page + 1} / {totalPages} ページ
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1}
            style={page >= totalPages - 1 ? paginationBtnDisabled : paginationBtn}
            aria-label="次のページ"
          >
            ›
          </button>
          <button
            onClick={() => handlePageChange(totalPages - 1)}
            disabled={page >= totalPages - 1}
            style={page >= totalPages - 1 ? paginationBtnDisabled : paginationBtn}
            aria-label="最後のページ"
          >
            »
          </button>
        </div>
      )}
    </section>
  )
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  padding: 'var(--spacing-lg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  backgroundColor: 'var(--color-bg)',
}

const inputStyle: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  flexGrow: 1,
  minWidth: 120,
}

const primaryBtn: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-md)',
  backgroundColor: 'var(--color-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

const dangerBtn: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  backgroundColor: 'transparent',
  color: 'var(--color-danger)',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

const paginationBtn: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  backgroundColor: 'transparent',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: '0.875rem',
  minWidth: '2rem',
}

const paginationBtnDisabled: React.CSSProperties = {
  ...paginationBtn,
  color: 'var(--color-text-muted)',
  cursor: 'not-allowed',
  opacity: 0.5,
}

const pageSizeBtn: React.CSSProperties = {
  padding: '2px var(--spacing-sm)',
  backgroundColor: 'transparent',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

const pageSizeBtnActive: React.CSSProperties = {
  ...pageSizeBtn,
  backgroundColor: 'var(--color-primary)',
  color: '#fff',
  borderColor: 'var(--color-primary)',
}
