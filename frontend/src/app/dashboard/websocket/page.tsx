import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import WebSocketDemo from '@/components/WebSocketDemo'

export default async function WebSocketPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <WebSocketDemo />
    </div>
  )
}
