'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine } from '@zell/core'

/** نفس مفتاح التخزين القديم — سلات الزباين الحالية ما تضيعش عند التحويل. */
const STORAGE_KEY = 'zell-cart-v2'

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'line-' + String(Date.now()) + '-' + Math.random().toString(36).slice(2)
}

function readStorage(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: CartLine[] = []
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue
      const line = entry as Partial<CartLine>
      if (!Number.isInteger(line.productId) || !Number.isInteger(line.lengthCm)) continue
      const base = {
        id: typeof line.id === 'string' ? line.id : newId(),
        productId: line.productId as number,
        lengthCm: line.lengthCm as number,
      }
      // 0015 — العرض اختياري؛ أي قيمة مش رقم صحيح موجب بتتشال
      const widthCm = line.widthCm
      out.push(typeof widthCm === 'number' && Number.isInteger(widthCm) && widthCm > 0 ? { ...base, widthCm } : base)
    }
    return out
  } catch {
    return []
  }
}

type CartApi = {
  lines: CartLine[]
  /** false لحد ما نقرا localStorage — يمنع وميض «السلة فاضية» بعد الـ hydration */
  ready: boolean
  count: number
  /** widthCm: العرض المختار — ناقص = العرض الأساسي. */
  add: (productId: number, lengthCm: number, widthCm?: number) => void
  setLength: (id: string, lengthCm: number) => void
  remove: (id: string) => void
  removeByProduct: (productId: number) => void
  clear: () => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)

  // القراءة بعد التركيب فقط — السيرفر مالوش localStorage
  useEffect(() => {
    setLines(readStorage())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // التخزين مقفول — السلة تفضل في الذاكرة بس
    }
  }, [lines, ready])

  const add = useCallback((productId: number, lengthCm: number, widthCm?: number) => {
    setLines((prev) => [
      ...prev,
      widthCm === undefined ? { id: newId(), productId, lengthCm } : { id: newId(), productId, lengthCm, widthCm },
    ])
  }, [])

  const setLength = useCallback((id: string, lengthCm: number) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, lengthCm } : line)))
  }, [])

  const remove = useCallback((id: string) => {
    setLines((prev) => prev.filter((line) => line.id !== id))
  }, [])

  const removeByProduct = useCallback((productId: number) => {
    setLines((prev) => prev.filter((line) => line.productId !== productId))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartApi>(
    () => ({ lines, ready, count: lines.length, add, setLength, remove, removeByProduct, clear }),
    [lines, ready, add, setLength, remove, removeByProduct, clear],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartApi {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart لازم يتستخدم جوه CartProvider')
  return context
}
