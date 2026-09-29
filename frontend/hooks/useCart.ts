import { useCallback, useEffect, useState } from 'react'

/** سطر في السلة: منتج + طول بالسنتيمتر. كل إضافة = سطر مستقل (شباك مختلف). */
export type CartLine = {
  id: string
  productId: number
  lengthCm: number
}

const STORAGE_KEY = 'zell-cart-v2'

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `line-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function read(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((line): line is Partial<CartLine> => typeof line === 'object' && line !== null)
      .filter((line) => Number.isInteger(line.productId) && Number.isInteger(line.lengthCm))
      .map((line) => ({
        id: typeof line.id === 'string' ? line.id : newId(),
        productId: line.productId as number,
        lengthCm: line.lengthCm as number,
      }))
  } catch {
    return []
  }
}

/** سلة بسيطة محفوظة في المتصفح — من غير أي اعتماد على Retool. */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(() => read())

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // التخزين مقفول — السلة تفضل في الذاكرة بس
    }
  }, [lines])

  const add = useCallback((productId: number, lengthCm: number) => {
    setLines((prev) => [...prev, { id: newId(), productId, lengthCm }])
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

  return { lines, add, setLength, remove, removeByProduct, clear }
}
