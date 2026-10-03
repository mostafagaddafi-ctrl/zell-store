import 'server-only'

import { normalizeSocialUrl, SOCIAL_LABELS, SOCIAL_PLATFORMS, type SocialPlatform } from '@zell/core'
import { restGet, restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'

/**
 * روابط السوشيال (settings.social_links) — { facebook: "https://…" }.
 * الفاضي مابيتحفظش، والرابط بيتظبط لـ https قبل الحفظ.
 * صف واحد — مش محتاج دالة ذرّية. النجاح بيتأكد بالقراءة.
 */
const KEY = 'social_links'

export type SocialLinksInput = Record<SocialPlatform, string>

function emptyLinks(): SocialLinksInput {
  return { facebook: '', instagram: '', tiktok: '', youtube: '', snapchat: '', x: '' }
}

function fromValue(value: unknown): SocialLinksInput {
  const out = emptyLinks()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  const raw = value as Record<string, unknown>
  for (const platform of SOCIAL_PLATFORMS) {
    const item = raw[platform]
    if (typeof item === 'string') out[platform] = item
  }
  return out
}

export async function readSocialLinks(): Promise<SocialLinksInput> {
  const rows = await restGet<{ value: unknown }>('settings', 'select=value&key=eq.' + KEY + '&limit=1')
  return fromValue(rows.rows[0]?.value)
}

export async function saveSocialLinks(raw: unknown): Promise<MutationResult<SocialLinksInput>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION', message: 'الروابط مش صحيحة' }
  }
  const input = raw as Record<string, unknown>
  const value: Partial<Record<SocialPlatform, string>> = {}
  for (const platform of SOCIAL_PLATFORMS) {
    const item = input[platform]
    if (item === undefined || item === null) continue
    if (typeof item !== 'string') return { ok: false, code: 'VALIDATION', message: 'رابط ' + SOCIAL_LABELS[platform] + ' مش صحيح' }
    if (item.trim() === '') continue
    const url = normalizeSocialUrl(item)
    if (url === null) {
      return { ok: false, code: 'VALIDATION', message: 'رابط ' + SOCIAL_LABELS[platform] + ' مش صحيح — انسخه من البروفايل زي ما هو' }
    }
    value[platform] = url
  }

  try {
    const changed = await restPatch<{ key: string }>('settings', 'key=eq.' + KEY, { value, updated_at: new Date().toISOString() })
    if (changed.length === 0) await restInsert('settings', { key: KEY, value })
    const stored = await readSocialLinks()
    for (const platform of SOCIAL_PLATFORMS) {
      if (stored[platform] !== (value[platform] ?? '')) return toInternalFailure(null)
    }
    return { ok: true, data: stored }
  } catch (error) {
    return toInternalFailure(error)
  }
}
