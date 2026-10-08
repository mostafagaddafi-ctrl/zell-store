import 'server-only'

/**
 * قراءات اتنقلت بالحرف من lib/mutations/socialLinks.ts (0021-P PR أ). مفيش أي تغيير جوه الدوال.
 */
import { SOCIAL_PLATFORMS } from '@zell/core'
import { restGet } from './client'
import type { SocialLinksInput } from '../mutations/socialLinks'

/**
 * روابط السوشيال (settings.social_links) — { facebook: "https://…" }.
 * الفاضي مابيتحفظش، والرابط بيتظبط لـ https قبل الحفظ.
 * صف واحد — مش محتاج دالة ذرّية. النجاح بيتأكد بالقراءة.
 */
export const KEY = 'social_links'

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
