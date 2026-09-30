/**
 * التنسيق كله بيمر على @zell/core — نفس الدوال اللي بتحسب للزبون بالظبط،
 * فمستحيل يختلف رقم بين اللوحة والمتجر.
 */
export { formatLength, formatPiastres } from '@zell/core'

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date)
}

/** جنيه للعرض في خانات الإدخال — اللوحة بتتعامل بالجنيه والتخزين بالقرش. */
export function piastresToPounds(piastres: number): string {
  return String(Math.round(piastres) / 100)
}

export function poundsToPiastres(pounds: string): number {
  const value = Number(pounds)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}
