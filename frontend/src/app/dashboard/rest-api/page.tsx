import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import RestApiDemo from '@/components/RestApiDemo'

export default async function RestApiPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/')

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <RestApiDemo />
    </div>
  )
}
