'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

const NAV_LINKS = [
  { href: '/dashboard/rest-api', label: 'REST API' },
  { href: '/dashboard/websocket', label: 'WebSocket' },
  { href: '/dashboard/sse', label: 'SSE' },
]

export default function NavBar() {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()

  // セッション切れ・別タブからのログアウトを検知してトップページへ戻す
  useEffect(() => {
    if (status === 'unauthenticated' && pathname.startsWith('/dashboard')) {
      router.push('/')
    }
  }, [status, pathname, router])

  return (
    <nav style={{
      borderBottom: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-bg)',
    }}>
      {/* ── メインバー ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--spacing-sm) var(--spacing-xl)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
          <Link href="/" style={{
            fontWeight: 700,
            fontSize: '1.125rem',
            textDecoration: 'none',
            color: 'var(--color-text)',
          }}>
            Boilerplate
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          {status === 'loading' && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Loading…</span>
          )}
          {status === 'authenticated' && session && (
            <>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                {session.user?.name ?? session.user?.email}
              </span>
              <button onClick={() => signOut({ callbackUrl: '/' })} style={ghostBtn}>
                Sign out
              </button>
            </>
          )}
          {status === 'unauthenticated' && (
            <button onClick={() => signIn('keycloak')} style={primaryBtn}>
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* ── サブナビゲーション（ログイン時のみ表示）── */}
      {session && (
        <div style={{
          display: 'flex',
          gap: 0,
          padding: '0 var(--spacing-xl)',
          borderTop: '1px solid var(--color-border)',
        }}>
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href
            return (
              <Link
                key={href}
                href={href}
                style={{
                  padding: 'var(--spacing-xs) var(--spacing-md)',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  textDecoration: 'none',
                  borderBottom: isActive
                    ? '2px solid var(--color-primary)'
                    : '2px solid transparent',
                  marginBottom: -1,
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {label}
              </Link>
            )
          })}
        </div>
      )}
    </nav>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-md)',
  backgroundColor: 'var(--color-primary)',
  color: '#fff',
  border: '1px solid var(--color-primary)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
}

const ghostBtn: React.CSSProperties = {
  padding: 'var(--spacing-xs) var(--spacing-md)',
  backgroundColor: 'transparent',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
}
