/**
 * META-PIXEL (docs/contracts/META-PIXEL.md §٢-٢ و§٢-٣) — جسر صغير بيتشحن مع كل الصفحات.
 *
 * المكوّنات (السلة · المنتج · الـ Checkout · اللينكات) بتنادي الدوال دي بس. السكربت الحقيقي ومنطق التسليح في
 * components/analytics/MetaPixel.tsx، وده بيتحمّل لوحده (dynamic) **بس** لما الـ ID صالح. لما الخانة فاضية الجسر
 * مابيتسجّلش أبدًا: مفيش أي طلب ولا كوكي، والتنقل زي ما هو بالحرف.
 *
 * ⚠️ مفيش أي نداء لـ fbq هنا. الأحداث قبل تسجيل الجسر بتستنى في الذاكرة (20 بالكتير) ومابتطلعش لأي مكان.
 */
import type { PixelEvent, PixelParams } from './pixelEvents'

export type PixelBridge = {
  track: (event: PixelEvent, params?: PixelParams) => void
  isArmed: () => boolean
  needsFullNavigation: (href: string) => boolean
  /** §٢-٥ — الـ ID اتفضّى أو بقى غلط والمستند مفتوح: وقف لباقي عمر المستند. */
  disable: () => void
  /** B1 — تغيّر المسار من MetaPixelLoader (بيفضل مركّب)، فالحراسة بتشوفه حتى بعد إلغاء تركيب MetaPixel. */
  locationChanged: () => void
}

export type PixelBoot = {
  /** أول مسار للمستند (وقت أول تقييم للموديول في المتصفح). */
  initialPath: string
  /** المستند مرّ على مسار محجوب (ع١). */
  visitedBlocked: boolean
  pending: Array<{ event: PixelEvent; params: PixelParams | undefined }>
  bridge: PixelBridge | null
}

export const PIXEL_PENDING_MAX = 20

/** §٢-٢ — المسارات المحجوبة: /order و/order/* و/track و/track/*. */
export function isBlockedPath(pathname: string): boolean {
  const path = pathname.toLowerCase()
  return path === '/order' || path.startsWith('/order/') || path === '/track' || path.startsWith('/track/')
}

const holder = globalThis as typeof globalThis & { __zellPixelBoot?: PixelBoot }

export function pixelBoot(): PixelBoot {
  let boot = holder.__zellPixelBoot
  if (!boot) {
    const initialPath = typeof window === 'undefined' ? '' : window.location.pathname
    boot = { initialPath, visitedBlocked: isBlockedPath(initialPath), pending: [], bridge: null }
    holder.__zellPixelBoot = boot
  }
  return boot
}

// أول تقييم في المتصفح بيثبّت أول مسار للمستند
if (typeof window !== 'undefined') pixelBoot()

/** بيتنادى مع كل مسار (MetaPixelLoader): المرور بمسار محجوب بيلوّث المستند لباقي عمره. */
export function markPixelPath(pathname: string): void {
  try {
    if (isBlockedPath(pathname)) pixelBoot().visitedBlocked = true
    // B1 — تغيّر المسار بيوصل لحراسة المستند (لو اتسلّح قبل كده) حتى بعد ما الـ ID اتفضّى
    pixelBoot().bridge?.locationChanged()
  } catch {
    // التتبّع عمره ما يوقف الصفحة
  }
}

export function trackPixel(event: PixelEvent, params?: PixelParams): void {
  try {
    const boot = pixelBoot()
    if (boot.bridge) boot.bridge.track(event, params)
    else if (boot.pending.length < PIXEL_PENDING_MAX) boot.pending.push({ event, params })
  } catch {
    // التتبّع عمره ما يرمي خطأ
  }
}

/** المستند مسلّح = الـ ID صالح والمكوّن اشتغل (سواء السكربت اتطلب أو لأ). */
export function pixelArmed(): boolean {
  try {
    return pixelBoot().bridge?.isArmed() === true
  } catch {
    return false
  }
}

export function pixelNeedsFullNavigation(href: string): boolean {
  try {
    return pixelBoot().bridge?.needsFullNavigation(href) === true
  } catch {
    return false
  }
}

/** §٢-٥ — من MetaPixelLoader لما الـ ID يبقى فاضي أو غلط: بيوقف المستند لو المكوّن كان اشتغل، وإلا ولا حاجة. */
export function disablePixel(): void {
  try {
    pixelBoot().bridge?.disable()
  } catch {
    // التتبّع عمره ما يوقف الصفحة
  }
}

/**
 * §٢-٢ ع٢ — التنقل للإيصال: في المستند المسلّح مستند جديد (تنقل كامل، من غير انتظار أي حاجة من ميتا)،
 * وفي غيره router.push زي الأول بالحرف.
 */
export function navigateToReceipt(router: { push: (href: string) => void }, href: string): void {
  if (pixelArmed()) window.location.assign(href)
  else router.push(href)
}
