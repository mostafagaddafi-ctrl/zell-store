import { timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { STOREFRONT_CACHE_TAG } from '../../../lib/data/supabaseServer'

export const dynamic = 'force-dynamic'

function matchesSecret(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = (process.env['REVALIDATE_SECRET'] ?? '').trim()
  const received = (request.headers.get('x-revalidate-secret') ?? '').trim()
  if (expected === '' || received === '' || !matchesSecret(received, expected)) {
    return NextResponse.json({ ok: false, message: 'غير مصرح.' }, { status: 401 })
  }

  revalidateTag(STOREFRONT_CACHE_TAG)
  return NextResponse.json({ ok: true })
}
