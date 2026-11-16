/**
 * META-PIXEL §٢-٢ و§٢-٢-ب و§٢-٣ — حالة المستند والطابور والتهيئة (ت١). منطق بيئة محقونة (PixelEnv)، فبيتختبر من غير متصفح.
 *
 * المراحل: idle (مش مسلّح) ← armed (الـ ID صالح) ← requested (عنصر السكربت اتضاف) ← ready (بعد init في ت١) · off (موقوف).
 * ملوّث (tainted) = لا طلب ولا init ولا تسليم لباقي عمر المستند.
 *
 * 🔒 طابور fbq المؤقت بيتعرّف فاضي، ومفيش init ولا set ولا أي أمر فيه الـ ID قبل ت١.
 * 🔒 ت١ في معالج load بتاع عنصر السكربت: فحص مباشر للحالة الحالية ثم set وinit في نفس الدورة، من غير أي تأجيل.
 */
import { normalizeMetaPixelId } from '@zell/core'
import { canInit, cleanUrlFor, isBlockedPath, isCleanHref, isCleanReferrer, type PixelCatalog } from './metaPixel'
import type { PixelEvent, PixelParams } from './pixelEvents'

export const PIXEL_SDK_SRC = 'https://connect.facebook.net/en_US/fbevents.js'
export const PIXEL_QUEUE_MAX = 20
export const PIXEL_LOAD_TIMEOUT_MS = 15000

export type FbqLike = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[] }

export type PixelEnv = {
  href: () => string
  origin: string
  referrer: string
  replaceUrl: (url: string) => void
  getFbq: () => FbqLike | undefined
  /** الطابور المؤقت المعتاد فاضي، وعليه disablePushState بس (من غير الـ ID). */
  installStub: () => void
  loadScript: (src: string, onLoad: () => void, onError: () => void) => void
  setTimer: (fn: () => void, ms: number) => void
  /** وقت monotonic بالمللي ثانية (performance.now في المتصفح) — موعد مهلة ت١ (B2). */
  now: () => number
  /** بعد حدث load للصفحة وفي وقت فاضي للمتصفح. */
  afterLoadIdle: (fn: () => void) => void
  reload: () => void
}

export type PixelPhase = 'idle' | 'armed' | 'requested' | 'ready' | 'off'

/** ع١-ب — العناوين اللي المستند مرّ بيها قبل التسليح (من الجسر)، وهل السجل ناقص. */
export type PixelPrior = { hrefs: readonly string[]; overflow: boolean }

const NO_PRIOR: PixelPrior = { hrefs: [], overflow: false }

const EMPTY_CATALOG: PixelCatalog = { productIds: new Set<string>(), collectionSlugs: new Set<string>() }

function pathOf(href: string): string {
  try {
    return new URL(href).pathname
  } catch {
    return ''
  }
}

export function createPixelRuntime(env: PixelEnv, initiallyTainted: boolean) {
  let phase: PixelPhase = 'idle'
  let tainted = initiallyTainted
  let timedOut = false
  /** B2 — موعد المهلة بمرجع monotonic، بيتحط مع بدء الطلب وبيتفحص مباشرة في ت١. */
  let deadline = Number.POSITIVE_INFINITY
  /** B1 — الـ SDK اتطلب في المستند ده (مش مستنتج من المرحلة): بيفضل true لحد قفل المستند، والحراسة معاه. */
  let sdkRequested = false
  let id = ''
  let catalog: PixelCatalog = EMPTY_CATALOG
  let queue: Array<{ event: PixelEvent; params: PixelParams | undefined }> = []

  function clearStubQueue(): void {
    const fbq = env.getFbq()
    if (fbq && typeof fbq.callMethod !== 'function' && Array.isArray(fbq.queue)) fbq.queue.length = 0
  }

  function taint(): void {
    tainted = true
    queue = []
    try {
      clearStubQueue()
    } catch {
      // ولا حاجة
    }
    try {
      const result = cleanUrlFor(env.href(), env.origin, catalog)
      if (result.pathOk && result.changed) env.replaceUrl(result.url)
    } catch {
      // ولا حاجة
    }
  }

  function stop(): void {
    phase = 'off'
    queue = []
    try {
      clearStubQueue()
    } catch {
      // ولا حاجة
    }
  }

  /** ع١-ب — أي عنوان قبل التسليح غير العنوان الحالي مش نضيف، أو السجل ناقص ⇐ تاريخ مش معروف. */
  function priorUnclean(prior: PixelPrior): boolean {
    if (prior.overflow) return true
    const current = env.href()
    return prior.hrefs.some((href) => href !== current && !isCleanHref(href, env.origin, catalog))
  }

  /** ن١ — قبل بدء الطلب: الـ query والـ hash بيتنضّفوا، والمسار مش نضيف = تلوّث. */
  function ensureClean(): boolean {
    const result = cleanUrlFor(env.href(), env.origin, catalog)
    if (!result.pathOk) {
      taint()
      return false
    }
    if (result.changed) {
      try {
        env.replaceUrl(result.url)
      } catch {
        taint()
        return false
      }
      if (!isCleanHref(env.href(), env.origin, catalog)) {
        taint()
        return false
      }
    }
    return true
  }

  function send(event: PixelEvent, params: PixelParams | undefined): void {
    const fbq = env.getFbq()
    if (!fbq) return
    try {
      if (params) fbq('track', event, params)
      else fbq('track', event)
    } catch {
      // التتبّع عمره ما يرمي خطأ
    }
  }

  /** ن٢ — كل تسليم بشرط العنوان الحالي نضيف. */
  function flush(): void {
    const items = queue
    queue = []
    for (const item of items) {
      if (tainted || phase !== 'ready') return
      if (!isCleanHref(env.href(), env.origin, catalog)) {
        taint()
        return
      }
      send(item.event, item.params)
    }
  }

  /** ت١ — في معالج load بتاع عنصر السكربت. */
  function onScriptLoad(): void {
    if (phase !== 'requested') return
    // B2 — المهلة بالموعد المحفوظ نفسه، مش بتنفيذ callback المؤقّت (ممكن يتأخر لو الخيط الرئيسي مشغول)
    if (env.now() >= deadline) timedOut = true
    const hrefClean = isCleanHref(env.href(), env.origin, catalog)
    const referrerClean = isCleanReferrer(env.referrer, env.origin, catalog)
    const fbq = env.getFbq()
    if (!canInit({ tainted, stopped: false, timedOut, hrefClean, referrerClean, id, fbq })) {
      if (!tainted && (!hrefClean || !referrerClean)) taint()
      stop()
      return
    }
    try {
      const ready = fbq as FbqLike
      ready('set', 'autoConfig', false, id)
      ready('init', id)
    } catch {
      stop()
      return
    }
    phase = 'ready'
    flush()
  }

  function request(): void {
    if (phase !== 'armed' || tainted) return
    if (!ensureClean()) return
    try {
      env.installStub()
    } catch {
      stop()
      return
    }
    phase = 'requested'
    sdkRequested = true
    deadline = env.now() + PIXEL_LOAD_TIMEOUT_MS
    // المؤقّت للتنضيف بس (وقف وتفضية الطابور)؛ قرار ت١ بالموعد المحفوظ فوق
    env.setTimer(() => {
      if (phase === 'requested') {
        timedOut = true
        stop()
      }
    }, PIXEL_LOAD_TIMEOUT_MS)
    try {
      env.loadScript(PIXEL_SDK_SRC, onScriptLoad, () => {
        if (phase === 'requested') stop()
      })
    } catch {
      stop()
    }
  }

  return {
    phase: (): PixelPhase => phase,
    isTainted: (): boolean => tainted,
    queued: (): number => queue.length,
    sdkRequested: (): boolean => sdkRequested,

    /** التسليح مرة واحدة لكل مستند، والـ ID بيتثبت. */
    arm(rawId: string, next: PixelCatalog, prior: PixelPrior = NO_PRIOR): void {
      if (phase !== 'idle') return
      const pinned = normalizeMetaPixelId(rawId)
      if (pinned === '') return
      id = pinned
      catalog = next
      phase = 'armed'
      if (tainted) {
        queue = []
        return
      }
      // ع١-ب — تاريخ المستند قبل وصول الـ runtime مايتنساش
      if (priorUnclean(prior)) {
        taint()
        return
      }
      if (isBlockedPath(pathOf(env.href())) || !isCleanReferrer(env.referrer, env.origin, catalog)) {
        taint()
        return
      }
      if (!ensureClean()) return
      env.afterLoadIdle(request)
    },

    /** §٢-٥ — فاضي أو غلط ⇐ وقف · ID تاني صالح ⇐ بيتجاهل لحد مستند جديد. */
    updateId(rawId: string): void {
      if (phase === 'idle' || phase === 'off') return
      if (normalizeMetaPixelId(rawId) === '') stop()
    },

    /**
     * تغيّر في العنوان (مسار أو hash أو popstate). B1 — حراسة المستند منفصلة عن إيقاف الأحداث: لو الـ SDK اتطلب في
     * المستند ده، الحراسة بتفضل شغّالة لحد قفله حتى مع ID فاضي أو مرحلة off أو تلوّث (السكربت وإرسالاته المعلّقة
     * مابيختفوش بإيقافنا). لو ماتطلبش، السلوك زي الأول.
     */
    onLocationChange(): void {
      const path = pathOf(env.href())
      if (isBlockedPath(path)) {
        const hadSdk = sdkRequested
        taint()
        // ع٣ — شبكة أمان: المفروض مايحصلش (ع٢)
        if (hadSdk) env.reload()
        return
      }
      if (phase === 'idle') return
      if (!sdkRequested) {
        if (phase === 'armed' && !tainted) ensureClean()
        return
      }
      // ن٣ — بعد طلب الـ SDK: أي عنوان مش نضيف ⇐ تلوّث وتنضيف (taint)، مهما كانت المرحلة
      if (!isCleanHref(env.href(), env.origin, catalog)) taint()
    },

    track(event: PixelEvent, params?: PixelParams): void {
      try {
        if (tainted || phase === 'off') return
        if (phase === 'ready') {
          if (!isCleanHref(env.href(), env.origin, catalog)) {
            taint()
            return
          }
          send(event, params)
          return
        }
        if (queue.length < PIXEL_QUEUE_MAX) queue.push({ event, params })
      } catch {
        // التتبّع عمره ما يرمي خطأ
      }
    },

    isArmed: (): boolean => phase !== 'idle',

    /** ع٢ — في المستند المسلّح، أي عنوان داخلي مش نضيف (محجوب أو مش معروف) = تنقل كامل. */
    needsFullNavigation(href: string): boolean {
      if (phase === 'idle') return false
      try {
        return !isCleanHref(new URL(href, env.href()).href, env.origin, catalog)
      } catch {
        return true
      }
    },
  }
}

export type PixelRuntime = ReturnType<typeof createPixelRuntime>
