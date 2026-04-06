import type { Metadata } from 'next'
import Providers from '@/components/Providers'
import NavBar from '@/components/NavBar'
import './globals.css'

export const metadata: Metadata = {
  title: 'Boilerplate App',
  description: 'Next.js + FastAPI + PostgreSQL + Keycloak boilerplate',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <NavBar />
          <main style={{ padding: 'var(--spacing-xl)' }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
