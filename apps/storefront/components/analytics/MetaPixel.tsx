'use client'

/**
 * META-PIXEL — المكوّن اللي بيشغّل الـ runtime في المتصفح. بيتحمّل لوحده (dynamic من MetaPixelLoader) بس لما الـ ID صالح.
 * العقد: docs/contracts/META-PIXEL.md §٢-٢ و§٢-٢-ب و§٢-٣.
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createPixelRuntime, type FbqLike, type PixelEnv, type PixelRuntime } from '../../lib/analytics/pixelRuntime'
import { isBlockedPath, pixelBoot } from '../../lib/analytics/pixelBridge'

type FbqStub = FbqLike & { push?: unknown; loaded?: boolean; version?: string; disablePushState?: boolean }
type PixelWindow = Window & { fbq?: FbqStub; _fbq?: FbqStub }

function browserEnv(): PixelEnv {
  const w = window as PixelWindow
  return {
    href: () => window.location.href,
    origin: window.location.origin,
    referrer: document.referrer,
    replaceUrl: (url) => {
      window.history.replaceState(window.history.state, '', url)
    },
    getFbq: () => w.fbq,
    installStub: () => {
      if (w.fbq) return
      // نفس الطابور المعتاد، فاضي ومن غير أي أمر أو ID
      const stub = function (...args: unknown[]): void {
        if (typeof stub.callMethod === 'function') (stub.callMethod as (...a: unknown[]) => void).apply(stub, args)
        else stub.queue?.push(args)
      } as FbqStub
      stub.push = stub
      stub.loaded = true
      stub.version = '2.0'
      stub.queue = []
      stub.disablePushState = true
      w.fbq = stub
      w._fbq = stub
    },
    loadScript: (src, onLoad, onError) => {
      const script = document.createElement('script')
      script.async = true
      script.src = src
      script.addEventListener('load', onLoad)
      script.addEventListener('error', onError)
      document.body.appendChild(script)
    },
    setTimer: (fn, ms) => {
      window.setTimeout(fn, ms)
    },
    now: () => performance.now(),
    afterLoadIdle: (fn) => {
      const go = (): void => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout: 4000 })
        else window.setTimeout(fn, 1)
      }
      if (document.readyState === 'complete') go()
      else window.addEventListener('load', go, { once: true })
    },
    reload: () => {
      window.location.reload()
    },
  }
}

let runtime: PixelRuntime | null = null

function getRuntime(): PixelRuntime {
  if (runtime) return runtime
  const boot = pixelBoot()
  runtime = createPixelRuntime(browserEnv(), boot.visitedBlocked || isBlockedPath(boot.initialPath))
  return runtime
}

/**
 * B1 — حراسة المستند: hashchange · popstate · حارس الروابط. بتتركّب مرة واحدة لكل مستند بعد التسليح و**مابتتشالش**
 * بإلغاء تركيب MetaPixel (لما الـ ID يتفضّى بـ router.refresh)، لأن السكربت المحمّل وإرسالاته المعلّقة بيفضلوا لحد قفل
 * المستند. القرار نفسه في الـ runtime (onLocationChange · needsFullNavigation) حسب «الـ SDK اتطلب» مش حسب المرحلة.
 */
let guardsInstalled = false

function installDocumentGuards(rt: PixelRuntime): void {
  if (guardsInstalled) return
  guardsInstalled = true
  const onChange = (): void => rt.onLocationChange()
  // ع٢ — أي لينك داخلي لعنوان مش نضيف (محجوب أو مش معروف، ومنه روابط «المحتوى») = تنقل كامل لمستند جديد
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    if ((anchor.target !== '' && anchor.target !== '_self') || anchor.hasAttribute('download')) return
    let url: URL
    try {
      url = new URL(anchor.href, window.location.href)
    } catch {
      return
    }
    if (url.origin !== window.location.origin) return
    if (!rt.needsFullNavigation(url.href)) return
    event.preventDefault()
    window.location.assign(url.href)
  }
  window.addEventListener('hashchange', onChange)
  window.addEventListener('popstate', onChange)
  document.addEventListener('click', onClick, true)
}

type Props = { pixelId: string; productIds: string[]; collectionSlugs: string[] }

export function MetaPixel({ pixelId, productIds, collectionSlugs }: Props) {
  const pathname = usePathname()
  const initial = useRef({ pixelId, productIds, collectionSlugs })

  useEffect(() => {
    const rt = getRuntime()
    const first = initial.current
    rt.arm(first.pixelId, { productIds: new Set(first.productIds), collectionSlugs: new Set(first.collectionSlugs) })
    // §٢-٥ — disable من MetaPixelLoader لما الـ ID يتفضّى والمستند مفتوح (المكوّن ده مابيترسمش تاني ساعتها)
    pixelBoot().bridge = {
      track: rt.track,
      isArmed: rt.isArmed,
      needsFullNavigation: rt.needsFullNavigation,
      disable: () => rt.updateId(''),
      locationChanged: () => rt.onLocationChange(),
    }

    // B1 — حراسة المستند بتتركّب مرة واحدة ومابتتشالش بإلغاء تركيب المكوّن
    installDocumentGuards(rt)
  }, [])

  useEffect(() => {
    getRuntime().updateId(pixelId)
  }, [pixelId])

  useEffect(() => {
    const rt = getRuntime()
    rt.onLocationChange()
    rt.track('PageView')
    // الأحداث اللي اتنادت قبل ما المكوّن يشتغل (زي ViewContent في أول عرض) بعد PageView
    const boot = pixelBoot()
    for (const item of boot.pending.splice(0)) rt.track(item.event, item.params)
  }, [pathname])

  return null
}
