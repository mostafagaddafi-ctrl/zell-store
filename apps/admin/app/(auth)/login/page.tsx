import type { Metadata } from 'next'
import { sanitizeNext } from '../../../lib/auth/nextPath'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'تسجيل الدخول',
  robots: { index: false, follow: false },
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams

  // التنظيف على السيرفر قبل ما القيمة تلمس الـ HTML أصلًا
  const rawNext = typeof params['next'] === 'string' ? params['next'] : null
  const next = sanitizeNext(rawNext)
  const unavailable = params['error'] === 'unavailable'

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-lg font-extrabold text-brand">ZELL</p>
        <p className="text-xs text-muted">لوحة التحكم</p>
      </div>

      {unavailable ? (
        <p
          role="status"
          className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs font-medium text-danger"
        >
          خدمة الدخول غير متاحة حاليًا. يُرجى المحاولة لاحقًا.
        </p>
      ) : null}

      <LoginForm next={next} />

      <p className="text-center text-[11px] text-muted">
        الدخول للمستخدمين المصرّح لهم فقط، ولا يتوفر تسجيل حسابات جديدة.
      </p>
    </div>
  )
}
