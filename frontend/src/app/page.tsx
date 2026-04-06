'use client'

import { useSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function HomePage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // ログイン済みなら REST API デモページへ直接遷移
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/dashboard/rest-api')
    }
  }, [status, router])

  return (
    <div style={{ maxWidth: 560, margin: '4rem auto', textAlign: 'center' }}>
      <h1>Next.js + FastAPI Boilerplate</h1>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-xl)' }}>
        A full-stack boilerplate with Next.js, FastAPI, PostgreSQL, and Keycloak SSO.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 'var(--spacing-md)',
        marginBottom: 'var(--spacing-xl)',
      }}>
        {[
          { label: 'REST API', desc: 'CRUD with JWT auth' },
          { label: 'WebSockets', desc: 'Real-time broadcast' },
          { label: 'Keycloak SSO', desc: 'OpenID Connect' },
        ].map((f) => (
          <div key={f.label} style={{
            padding: 'var(--spacing-md)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            backgroundColor: 'var(--color-bg-subtle)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>{f.label}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      {status !== 'loading' && !session && (
        <button
          onClick={() => signIn('keycloak')}
          style={{
            padding: 'var(--spacing-sm) var(--spacing-xl)',
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign in with Keycloak
        </button>
      )}

      {status === 'loading' && (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      )}
    </div>
  )
}
