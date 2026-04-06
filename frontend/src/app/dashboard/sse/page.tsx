import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import SseDemo from '@/components/SseDemo'

export default async function SsePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <SseDemo />
    </div>
  )
}
