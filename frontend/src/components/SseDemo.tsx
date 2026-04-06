'use client'

/**
 * SSE（Server-Sent Events）デモ
 *
 * Chapter 4「Server-Sent Events (SSE)」の実装サンプル。
 *
 * ── WebSocket との違い ───────────────────────────────────────────────
 *  SSE         : サーバー → クライアント（一方向）。HTTP のまま動作。
 *                長時間タスクの進捗通知・ログ・AI レスポンスに最適。
 *  WebSocket   : 双方向通信。チャット・ゲーム・リアルタイム共同編集に最適。
 *
 * ── EventSource の認証問題と解決策 ──────────────────────────────────
 *  EventSource は Authorization ヘッダーを送れないため、
 *  以下の 2 ステップに分割します:
 *    1. POST /api/sse/tasks  → Bearer 認証し task_id を取得
 *    2. EventSource で /api/sse/tasks/{task_id} を購読
 *       task_id が暗黙の認証トークンとして機能する
 */

import { useState, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { fetchWithRetry } from '@/lib/fetch'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost'

interface TaskEvent {
  type: 'status' | 'complete' | 'error'
  step: string
  message: string
  progress?: number
}

type RunStatus = 'idle' | 'running' | 'complete' | 'error'

const STEP_ICON: Record<string, string> = {
  init:     '⚙️',
  fetch:    '📥',
  process:  '🔄',
  validate: '✅',
  complete: '🎉',
}

export default function SseDemo() {
  const { data: session } = useSession()
  const [events, setEvents]       = useState<TaskEvent[]>([])
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [progress, setProgress]   = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const startTask = useCallback(async () => {
    if (!session?.accessToken) return

    // リセット
    esRef.current?.close()
    setEvents([])
    setProgress(0)
    setError(null)
    setRunStatus('running')

    try {
      // ── Step 1: POST でタスク開始（Bearer 認証 + リトライ）──────
      const res = await fetchWithRetry(
        `${API_URL}/api/sse/tasks`,
        { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
        { maxRetries: 3 },
      )
      if (!res.ok) throw new Error(`タスクの開始に失敗しました (${res.status})`)
      const { task_id } = await res.json()

      // ── Step 2: EventSource で SSE を購読 ─────────────────────
      // ブラウザ組み込みの EventSource API を使用
      // 自動再接続・イベントタイプ別のリスナーが標準で備わっている
      const es = new EventSource(`${API_URL}/api/sse/tasks/${task_id}`)
      esRef.current = es

      es.addEventListener('status', (e) => {
        const data = JSON.parse(e.data) as TaskEvent
        setEvents((prev) => [...prev, { ...data, type: 'status' }])
        setProgress(data.progress ?? 0)
      })

      es.addEventListener('complete', (e) => {
        const data = JSON.parse(e.data) as TaskEvent
        setEvents((prev) => [...prev, { ...data, type: 'complete' }])
        setProgress(100)
        setRunStatus('complete')
        es.close()
      })

      es.onerror = () => {
        // EventSource は接続エラー時に自動で再接続しようとする
        // タスク完了後の接続終了でも onerror が呼ばれるため状態を確認
        setError('接続が切断されました。')
        setRunStatus('error')
        es.close()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました')
      setRunStatus('error')
    }
  }, [session?.accessToken])

  const reset = () => {
    esRef.current?.close()
    setEvents([])
    setProgress(0)
    setError(null)
    setRunStatus('idle')
  }

  const progressColor = {
    running:  'var(--color-primary)',
    complete: 'var(--color-success)',
    error:    'var(--color-danger)',
    idle:     'var(--color-primary)',
  }[runStatus]

  return (
    <section style={card}>
      {/* ── ヘッダー ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h2 style={{ margin: 0 }}>SSE — タスク進捗</h2>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
          {runStatus === 'running' ? (
            <button onClick={reset} style={ghostBtn}>キャンセル</button>
          ) : (
            <button onClick={startTask} style={primaryBtn}>
              {runStatus === 'idle' ? 'タスク開始' : '再実行'}
            </button>
          )}
        </div>
      </div>

      {/* ── プログレスバー ──────────────────────────────────────────── */}
      <div style={{
        height: 8,
        backgroundColor: 'var(--color-bg-subtle)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--spacing-md)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          backgroundColor: progressColor,
          borderRadius: 'var(--radius-md)',
          transition: 'width 0.5s ease, background-color 0.3s ease',
        }} />
      </div>

      {/* ── イベントログ ────────────────────────────────────────────── */}
      <div style={{
        minHeight: 168,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-sm)',
        backgroundColor: 'var(--color-bg-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xs)',
        marginBottom: 'var(--spacing-sm)',
      }}>
        {events.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 'auto', textAlign: 'center' }}>
            「タスク開始」をクリックすると<br />
            進捗がリアルタイムで表示されます。
          </p>
        ) : (
          events.map((ev, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', fontSize: '0.875rem' }}>
              <span style={{ flexShrink: 0 }}>{STEP_ICON[ev.step] ?? '•'}</span>
              <span style={{
                fontWeight: ev.type === 'complete' ? 600 : 400,
                color:      ev.type === 'complete' ? 'var(--color-success)' : 'var(--color-text)',
              }}>
                {ev.message}
              </span>
              {ev.progress != null && (
                <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                  {ev.progress}%
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── エラー ──────────────────────────────────────────────────── */}
      {error && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: 'var(--spacing-sm)' }}>
          ⚠️ {error}
        </p>
      )}

      {/* ── WebSocket との比較 ──────────────────────────────────────── */}
      <details style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-sm)' }}>
        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
          WebSocket との使い分け（Chapter 4）
        </summary>
        <div style={{ marginTop: 'var(--spacing-sm)', lineHeight: 1.7 }}>
          <strong>SSE（このデモ）:</strong> サーバー→クライアントの一方向。
          通常の HTTP 接続のまま動作。ブラウザが自動再接続。
          長時間タスクの進捗・ログストリーミング・AI レスポンスに最適。<br />
          <strong>WebSocket（別タブ）:</strong> 双方向通信。HTTP から Upgrade が必要。
          チャット・ゲーム・リアルタイム共同編集に最適。
        </div>
      </details>
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
