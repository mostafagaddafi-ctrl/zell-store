'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Gift, X } from 'lucide-react'
import type { Announcement } from '@zell/core'
import { Container } from '../ui/Container'

/**
 * شريط العرض — «هدية نازلة من فوق».
 *
 * أعلى الصفحة، فوق الهيدر. بعد التحميل بلحظة المساحة بتتفتح والشريط
 * بينزل، والأيقونة بتنط، ولمعة ذهبي بتعدّي مرة واحدة (globals.css).
 *
 * المحتوى:
 *   الشريط العلوي من صفحة المحتوى (مفعّل + فيه نص)  -> هو
 *   وإلا «نص العرض» من صفحة الهوية                  -> هو، من غير رابط
 *   الاتنين فاضيين                                   -> مفيش شريط
 *
 * ⚠️ مابيضايقش التصفح: static مش sticky (بيتلف مع السكرول والهيدر
 *    يفضل)، وحركته مرة واحدة بس، والزائر يقدر يقفله. القفل بيتحفظ
 *    في localStorage **ببصمة النص** — عرض جديد بيظهر تاني لوحده.
 *
 * ⚠️ مفيش وميض: الشريط مقفول في HTML السيرفر، وبيتفتح بس بعد ما
 *    نتأكد إن الزائر ماقفلوش قبل كده. فمفيش «يظهر ثم يختفي».
 *
 * ⚠️ مكان الشريط: layout.tsx، فوق SiteHeader مباشرة.
 *
 * ⚠️ الرابط مابيفتحش في تاب جديد. لو اتفتح يومًا، rel='noopener
 *    noreferrer' إلزامي.
 */

const STORAGE_PREFIX = 'zell:gift-bar:'
const REVEAL_DELAY_MS = 450

type Content = { text: string; href: string; ctaLabel: string }

function pickContent(announcement: Announcement, offerText: string): Content | null {
  if (announcement.enabled && announcement.text.trim() !== '') {
    return {
      text: announcement.text.trim(),
      href: announcement.href.trim(),
      ctaLabel: announcement.ctaLabel.trim(),
    }
  }
  const offer = offerText.trim()
  return offer === '' ? null : { text: offer, href: '', ctaLabel: '' }
}

/** بصمة قصيرة (djb2) — مش أمان، بس تمييز عرض عن عرض. */
function fingerprint(content: Content): string {
  const source = content.text + '|' + content.href
  let hash = 5381
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

function wasDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function rememberDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // وضع خاص أو تخزين مقفول — الشريط هيتقفل للزيارة دي بس
  }
}

export function AnnouncementBar({
  announcement,
  offerText,
}: {
  announcement: Announcement
  offerText: string
}) {
  const content = pickContent(announcement, offerText)
  const storageKey = content === null ? null : STORAGE_PREFIX + fingerprint(content)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (storageKey === null || wasDismissed(storageKey)) return
    const timer = window.setTimeout(() => setShown(true), REVEAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [storageKey])

  if (content === null || storageKey === null) return null

  const key = storageKey
  const dismiss = () => {
    setShown(false)
    rememberDismissed(key)
  }

  const hasCta = content.href !== '' && content.ctaLabel !== ''
  const tabIndex = shown ? undefined : -1

  const message = (
    <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <span
        className="zell-gift-icon grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/20 text-gold ring-1 ring-gold/40"
        aria-hidden="true"
      >
        <Gift className="h-4 w-4" strokeWidth={2.25} />
      </span>
      <span className="line-clamp-2 text-xs font-bold leading-5 sm:text-sm">{content.text}</span>
      {hasCta ? (
        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-gold/50 px-2.5 py-0.5 text-xs font-extrabold text-gold min-[400px]:flex">
          {content.ctaLabel}
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  )

  return (
    <div
      className={
        'zell-gift grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none ' +
        (shown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
      }
      data-shown={shown ? '' : undefined}
    >
      <div className="min-h-0 overflow-hidden">
        <aside
          aria-label="عرض خاص"
          aria-hidden={!shown}
          className={
            'zell-gift-panel relative isolate overflow-hidden border-b border-gold/30 bg-brand text-brand-fg transition duration-500 ease-out motion-reduce:transition-none ' +
            (shown ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0')
          }
        >
          <Container className="flex min-h-11 items-center gap-2 py-1.5 sm:min-h-12">
            {/* موازن لزرار القفل عشان الرسالة تفضل في النص على الشاشات الأوسع */}
            <span className="hidden h-10 w-10 shrink-0 sm:block" aria-hidden="true" />

            {content.href !== '' ? (
              <Link
                href={content.href}
                tabIndex={tabIndex}
                className="flex min-w-0 flex-1 justify-center rounded transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {message}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 justify-center">{message}</div>
            )}

            <button
              type="button"
              onClick={dismiss}
              tabIndex={tabIndex}
              aria-label="اقفل العرض"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand-fg/70 transition-colors hover:bg-brand-fg/10 hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <X className="h-4 w-4" />
            </button>
          </Container>
        </aside>
      </div>
    </div>
  )
}
