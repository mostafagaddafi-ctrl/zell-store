import { NextResponse, type NextRequest } from 'next/server'
import { createAuthClient } from '../../../lib/auth/supabaseServer'

/**
 * الخروج **POST فقط**.
 *
 * GET كان هيخلي أي <img src="/auth/signout"> أو لينك في إيميل
 * يخرّج المستخدم من غير قصده. الخروج بيغيّر حالة، فمالوش GET.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createAuthClient()
    await supabase.auth.signOut()
  } catch {
    // حتى لو Supabase مردّش، الكوكيز بتتمسح والمستخدم بيروح /login
  }

  // 303 عشان المتصفح يحوّل الـ POST لـ GET على /login
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}

export function GET(): NextResponse {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
