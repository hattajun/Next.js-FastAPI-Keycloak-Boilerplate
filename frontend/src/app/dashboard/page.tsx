import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'

/**
 * /dashboard — 概要ページ
 * ログイン後のデフォルトリダイレクト先は /dashboard/rest-api だが、
 * /dashboard に直接アクセスされた場合のフォールバックとして機能する。
 */
export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>Dashboard</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-xl)' }}>
        Welcome, {session.user?.name ?? session.user?.email}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 'var(--spacing-lg)',
      }}>
        <DemoCard
          href="/dashboard/rest-api"
          title="REST API Demo"
          description="Keycloak JWT で保護された CRUD エンドポイントのサンプル"
        />
        <DemoCard
          href="/dashboard/websocket"
          title="WebSocket Demo"
          description="全クライアントへのブロードキャストチャットのサンプル"
        />
        <DemoCard
          href="/dashboard/sse"
          title="SSE Demo"
          description="長時間タスクの進捗をリアルタイムで受信するサンプル"
        />
      </div>
    </div>
  )
}

function DemoCard({ href, title, description }: {
  href: string
  title: string
  description: string
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        padding: 'var(--spacing-lg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--color-bg)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
      }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'var(--color-primary)'
          el.style.boxShadow = '0 2px 8px rgba(37,99,235,0.1)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'var(--color-border)'
          el.style.boxShadow = 'none'
        }}
      >
        <h2 style={{ marginBottom: 'var(--spacing-xs)', fontSize: '1.125rem' }}>{title}</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>
          {description}
        </p>
      </div>
    </Link>
  )
}
