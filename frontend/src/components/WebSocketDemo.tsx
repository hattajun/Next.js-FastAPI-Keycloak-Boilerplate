'use client'

/**
 * WebSocket デモ（チケットベース認証付き）
 *
 * ── 認証フロー ─────────────────────────────────────────────────────────
 * ブラウザの WebSocket API はカスタムヘッダーを送れないため、
 * SSE と同一のチケット方式を採用する。
 *
 *   Step 1: POST /api/ws/tickets
 *           Bearer トークンで認証 → ws_ticket（60秒 TTL）を取得
 *
 *   Step 2: WebSocket ws://host/ws/{clientId}?ticket={ws_ticket}
 *           チケットをクエリパラメータとして渡す
 *           バックエンドがチケットを検証・削除（一度きり）
 *
 *   → トークン期限切れ後は POST に失敗（401）→ 接続不可 ✅
 *
 * ── クローズコード ─────────────────────────────────────────────────────
 *   4008 Policy Violation: チケット無効・期限切れ・未指定
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { fetchWithRetry } from '@/lib/fetch'

interface ChatMessage {
  type: 'message' | 'system'
  client_id: string | null
  message: string
  timestamp: number
}

type ConnectStatus = 'disconnected' | 'fetching_ticket' | 'connecting' | 'connected'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost'
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost'

export default function WebSocketDemo() {
  const { data: session } = useSession()
  const [messages, setMessages]       = useState<ChatMessage[]>([])
  const [input, setInput]             = useState('')
  const [status, setStatus]           = useState<ConnectStatus>('disconnected')
  const [error, setError]             = useState<string | null>(null)
  const wsRef    = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // セッションから clientId を導出（表示名として使用）
  const clientId = session?.user?.email?.split('@')[0]
    ?? `guest-${Math.random().toString(36).slice(2, 7)}`

  // ── 接続処理 ──────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!session?.accessToken) {
      setError('認証トークンがありません。再ログインしてください。')
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    wsRef.current?.close()
    setError(null)
    setStatus('fetching_ticket')

    // Step 1: チケット取得（Bearer 認証）
    let ws_ticket: string
    try {
      const res = await fetchWithRetry(
        `${API_URL}/api/ws/tickets`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        },
        { maxRetries: 2 },
      )
      ;({ ws_ticket } = await res.json())
    } catch (e) {
      // 401 はトークン期限切れ → 再ログインを促す
      const msg = e instanceof Error ? e.message : 'チケット取得に失敗しました'
      setError(`接続できませんでした: ${msg}`)
      setStatus('disconnected')
      return
    }

    // Step 2: WebSocket 接続（チケットをクエリパラメータで渡す）
    setStatus('connecting')
    const ws = new WebSocket(`${WS_URL}/ws/${clientId}?ticket=${ws_ticket}`)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      setError(null)
    }

    ws.onmessage = (event) => {
      try {
        const msg: Omit<ChatMessage, 'timestamp'> = JSON.parse(event.data)
        setMessages((prev) => [...prev, { ...msg, timestamp: Date.now() }])
      } catch {
        // 不正なメッセージは無視
      }
    }

    ws.onclose = (event) => {
      wsRef.current = null
      setStatus('disconnected')
      // 4008 = Policy Violation（チケット認証失敗）
      if (event.code === 4008) {
        setError(`認証エラー: ${event.reason || 'チケットが無効または期限切れです'}`)
      }
    }

    ws.onerror = () => {
      setStatus('disconnected')
      wsRef.current = null
    }
  }, [session?.accessToken, clientId])

  const disconnect = () => {
    wsRef.current?.close()
    wsRef.current = null
    setStatus('disconnected')
  }

  // 最新メッセージへ自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // アンマウント時にクリーンアップ
  useEffect(() => {
    return () => { wsRef.current?.close() }
  }, [])

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ message: input.trim() }))
    setInput('')
  }

  // ── スタイル定義 ───────────────────────────────────────────────────────
  const statusColor: Record<ConnectStatus, string> = {
    connected:      'var(--color-success)',
    connecting:     '#d97706',
    fetching_ticket:'#d97706',
    disconnected:   'var(--color-text-muted)',
  }

  const statusLabel: Record<ConnectStatus, string> = {
    connected:       '接続中',
    connecting:      '接続しています...',
    fetching_ticket: 'チケット取得中...',
    disconnected:    '未接続',
  }

  const isConnecting = status === 'fetching_ticket' || status === 'connecting'

  return (
    <section style={cardStyle}>
      {/* ── ヘッダー ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h2 style={{ margin: 0 }}>WebSocket — Chat</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
          {/* ステータスインジケーター */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', fontSize: '0.8rem', color: statusColor[status] }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: statusColor[status], display: 'inline-block' }} />
            {statusLabel[status]}
          </span>
          {status === 'disconnected' ? (
            <button onClick={connect} disabled={isConnecting} style={primaryBtn}>
              接続
            </button>
          ) : isConnecting ? (
            <button disabled style={{ ...ghostBtn, opacity: 0.5 }}>接続中...</button>
          ) : (
            <button onClick={disconnect} style={ghostBtn}>切断</button>
          )}
        </div>
      </div>

      {/* ── エラー ────────────────────────────────────────────────── */}
      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>
          ⚠️ {error}
        </p>
      )}

      {/* ── メッセージログ ────────────────────────────────────────── */}
      <div style={{
        height: 240,
        overflowY: 'auto',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-sm)',
        marginBottom: 'var(--spacing-sm)',
        backgroundColor: 'var(--color-bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xs)',
      }}>
        {messages.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 'auto', textAlign: 'center' }}>
            「接続」をクリックしてチャットを開始<br/>
            <span style={{ fontSize: '0.75rem' }}>※ 別タブで開くとブロードキャストを確認できます</span>
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ fontSize: '0.875rem' }}>
            {msg.type === 'system' ? (
              <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                ⚡ {msg.message}
              </span>
            ) : (
              <span>
                <strong style={{ color: msg.client_id === clientId ? 'var(--color-primary)' : 'var(--color-text)' }}>
                  {msg.client_id === clientId ? 'You' : msg.client_id}:
                </strong>{' '}
                {msg.message}
              </span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── 送信フォーム ──────────────────────────────────────────── */}
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        <input
          type="text"
          placeholder={status === 'connected' ? 'メッセージを入力...' : '接続してから入力できます'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== 'connected'}
          style={{ ...inputStyle, flexGrow: 1, opacity: status !== 'connected' ? 0.5 : 1 }}
        />
        <button
          type="submit"
          disabled={status !== 'connected' || !input.trim()}
          style={{ ...primaryBtn, opacity: status !== 'connected' || !input.trim() ? 0.5 : 1 }}
        >
          送信
        </button>
      </form>

      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--spacing-xs)', marginBottom: 0 }}>
        接続ID: <code>{clientId}</code>
      </p>
    </section>
  )
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: 'var(--spacing-lg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  backgroundColor: 'var(--color-bg)',
}

const inputStyle: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
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

const ghostBtn: React.CSSProperties = {
  ...primaryBtn,
  backgroundColor: 'transparent',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
}
