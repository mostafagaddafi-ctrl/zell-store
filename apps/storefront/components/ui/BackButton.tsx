'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

/**
 * رجوع آمن جوه المتجر.
 *
 * NavHistory (في الـlayout) بيسجّل مسارات التاب ده في sessionStorage كـstack: مسار جديد = push،
 * والرجوع للمسار اللي قبله = pop. BackButton بيعمل router.back() بس لو فيه مسار سابق متسجّل من
 * المتجر نفسه، وإلا بيروح لـfallback ثابت — عمره ما يطلع بره المتجر ولا لصفحة فاضية.
 *
 * ⚠️ مابيمسحش أي حاجة: السلة والمقاسات واختيار التركيب في localStorage زي ما هم.
 */
const KEY = 'zell-nav-stack'
const MAX_ENTRIES = 30

function readStack(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStack(stack: string[]): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX_ENTRIES)))
  } catch {
    // التخزين مقفول — الرجوع هيستخدم الـfallback
  }
}

/** بيتحط مرة واحدة في الـlayout. مابيعرضش حاجة. */
export function NavHistory() {
  const pathname = usePathname()
  useEffect(() => {
    const stack = readStack()
    if (stack[stack.length - 1] === pathname) return
    if (stack[stack.length - 2] === pathname) {
      writeStack(stack.slice(0, -1))
      return
    }
    writeStack([...stack, pathname])
  }, [pathname])
  return null
}

export function BackButton({ fallback, label = 'رجوع' }: { fallback: string; label?: string }) {
  const router = useRouter()

  function goBack() {
    if (readStack().length >= 2 && window.history.length > 1) {
      router.back()
      return
    }
    router.push(fallback)
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent hover:underline"
    >
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  )
}
