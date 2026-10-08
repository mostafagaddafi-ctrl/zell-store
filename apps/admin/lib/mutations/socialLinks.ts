import 'server-only'

import { normalizeSocialUrl, SOCIAL_LABELS, SOCIAL_PLATFORMS, type SocialPlatform } from '@zell/core'
import { restInsert, restPatch } from '../data/client'
import type { MutationResult } from '../mutations'
import { toInternalFailure } from './errors'
import { readSocialLinks, KEY } from '../data/socialLinks'

export type SocialLinksInput = Record<SocialPlatform, string>

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
