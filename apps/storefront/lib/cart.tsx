'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine } from '@zell/core'

/** نفس مفتاح التخزين القديم — سلات الزباين الحالية ما تضيعش عند التحويل. */
const STORAGE_KEY = 'zell-cart-v2'

/**
 * PR4 — «هتركّبه إزاي؟» على مستوى السلة كلها. مفتاح لوحده جنب السلة عشان شكل
 * zell-cart-v2 مايتغيرش، والسلات القديمة (من غير المفتاح) = «هركّبه بنفسي».
 * نية بس: مش داخلة في الهاش ولا الطلب — Checkout بيحوّلها لـinstallation: true
 * بعد ما المنطقة تبقى متاحة (PR3).
 */
const INSTALL_MODE_KEY = 'zell-install-mode-v1'

export type InstallMode = 'self' | 'installer'

function readInstallMode(): InstallMode {
  try {
    return window.localStorage.getItem(INSTALL_MODE_KEY) === 'installer' ? 'installer' : 'self'
  } catch {
    return 'self'
  }
}

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
      // 0016 — سطر القطعة: عدد صحيح موجب
      const quantity = line.quantity
      if (typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0) {
        out.push({ ...base, quantity: Math.min(quantity, 999) })
        continue
      }
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
  /** عدد السطور (زي ما هو — بيستخدمه أي كود قديم). */
  count: number
  /**
   * إجمالي الكمية للعرض (أيقونة السلة): سطر المتر = ١، والمنتج بالعدد = كميته.
   * محسوب بس — مابيتخزّنش ومابيغيّرش السلة ولا الطلب.
   */
  itemCount: number
  /** widthCm: العرض المختار — ناقص = العرض الأساسي. */
  add: (productId: number, lengthCm: number, widthCm?: number) => void
  setLength: (id: string, lengthCm: number) => void
  /** 0016 — قطعة: لو موجودة في السلة العدد بيزيد (لحد max). */
  addPiece: (productId: number, quantity: number, max: number) => void
  setQuantity: (id: string, quantity: number) => void
  remove: (id: string) => void
  removeByProduct: (productId: number) => void
  clear: () => void
  /** PR4 — طريقة التركيب المختارة (نية بس). */
  installMode: InstallMode
  setInstallMode: (mode: InstallMode) => void
}

const CartContext = createContext<CartApi | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  const [installMode, setInstallMode] = useState<InstallMode>('self')

  // القراءة بعد التركيب فقط — السيرفر مالوش localStorage
  useEffect(() => {
    setLines(readStorage())
    setInstallMode(readInstallMode())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(INSTALL_MODE_KEY, installMode)
    } catch {
      // التخزين مقفول — الاختيار يفضل في الذاكرة بس
    }
  }, [installMode, ready])

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

  const addPiece = useCallback((productId: number, quantity: number, max: number) => {
    setLines((prev) => {
      const existing = prev.find((line) => line.productId === productId && line.quantity !== undefined)
      if (existing) {
        return prev.map((line) =>
          line.id === existing.id ? { ...line, quantity: Math.min(max, (line.quantity ?? 0) + quantity) } : line,
        )
      }
      return [...prev, { id: newId(), productId, lengthCm: 0, quantity: Math.min(max, quantity) }]
    })
  }, [])

  const setQuantity = useCallback((id: string, quantity: number) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, quantity } : line)))
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

  // بعد الطلب: السلة فاضية والاختيار يرجع «هركّبه بنفسي»
  const clear = useCallback(() => {
    setLines([])
    setInstallMode('self')
  }, [])

  const itemCount = useMemo(
    () => lines.reduce((sum, line) => sum + (line.quantity !== undefined ? line.quantity : 1), 0),
    [lines],
  )

  const value = useMemo<CartApi>(
    () => ({
      lines,
      ready,
      count: lines.length,
      itemCount,
      add,
      setLength,
      addPiece,
      setQuantity,
      remove,
      removeByProduct,
      clear,
      installMode,
      setInstallMode,
    }),
    [lines, ready, itemCount, add, setLength, addPiece, setQuantity, remove, removeByProduct, clear, installMode],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartApi {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart لازم يتستخدم جوه CartProvider')
  return context
}
