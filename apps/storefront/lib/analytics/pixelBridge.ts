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
  /** §٢-٥ — أهلية المستند من أول قيمة ID شافها في المتصفح (null = لسه). فاضي أو غلط ⇐ مش مؤهّل لباقي عمره. */
  eligible: boolean | null
  /** ع١-ب — عناوين المستند قبل التسليح (تقريب لسجل التنقّل فيه)، بحد PIXEL_SEEN_MAX. */
  seen: string[]
  /** ع١-ب — السجل عدّى الحد ⇐ مش معروف. */
  seenOverflow: boolean
  /** المسجّل اتركّب (مرة واحدة لكل مستند). */
  recorder: boolean
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
    boot = {
      initialPath,
      visitedBlocked: isBlockedPath(initialPath),
      pending: [],
      bridge: null,
      eligible: null,
      seen: typeof window === 'undefined' ? [] : [window.location.href],
      seenOverflow: false,
      recorder: false,
    }
    holder.__zellPixelBoot = boot
  }
  return boot
}

export const PIXEL_SEEN_MAX = 50

/**
 * ع١-ب — تسجيل عنوان المستند قبل التسليح: إضافة (pushState · hashchange · popstate · تغيّر المسار) أو استبدال آخر
 * عنوان (replaceState، لأن السطر القديم بيختفي من السجل). بعد تسجيل الجسر الحراسة هي اللي بتحكم، فمفيش تسجيل.
 */
function notePixelHref(replace: boolean): void {
  try {
    const boot = pixelBoot()
    if (boot.bridge) return
    const href = window.location.href
    if (replace && boot.seen.length > 0) {
      boot.seen[boot.seen.length - 1] = href
      return
    }
    if (boot.seen[boot.seen.length - 1] === href) return
    if (boot.seen.length >= PIXEL_SEEN_MAX) {
      boot.seenOverflow = true
      return
    }
    boot.seen.push(href)
  } catch {
    // التتبّع عمره ما يوقف الصفحة
  }
}

/** تسجيل بس: نفس النداء الأصلي بالحرف، وبعده تسجيل العنوان. مفيش أي طلب ولا تغيير في التنقل. */
function installHrefRecorder(): void {
  const history = window.history
  const push = history.pushState
  const replace = history.replaceState
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>): void {
    push.apply(this, args)
    notePixelHref(false)
  }
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>): void {
    replace.apply(this, args)
    notePixelHref(true)
  }
  window.addEventListener('hashchange', () => notePixelHref(false))
  window.addEventListener('popstate', () => notePixelHref(false))
}

// أول تقييم في المتصفح بيثبّت أول مسار وأول عنوان للمستند، وبيبدأ تسجيل العناوين قبل التسليح (ع١-ب)
if (typeof window !== 'undefined') {
  const boot = pixelBoot()
  if (!boot.recorder) {
    boot.recorder = true
    installHrefRecorder()
  }
}

/** ع١-ب — العناوين المسجّلة قبل التسليح (نسخة) وهل السجل ناقص. */
export function pixelPrior(): { hrefs: string[]; overflow: boolean } {
  const boot = pixelBoot()
  return { hrefs: boot.seen.slice(), overflow: boot.seenOverflow }
}

/** §٢-٥ — منطق خالص: أول قيمة بتثبّت الأهلية، وبعدها المسموح = مؤهّل والـ ID الحالي مش فاضي. */
export function decideEligibility(pinned: boolean | null, pixelId: string): { pinned: boolean; allowed: boolean } {
  const next = pinned === null ? pixelId !== '' : pinned
  return { pinned: next, allowed: next && pixelId !== '' }
}

/**
 * §٢-٥ — من MetaPixelLoader: المستند اللي أول ID شافه في المتصفح فاضي أو غلط مابيتسلّحش أبدًا، حتى لو وصل ID صالح بعدين
 * (router.refresh). على السيرفر مفيش تثبيت (قيمة الطلب بس).
 */
export function pixelEligible(pixelId: string): boolean {
  if (typeof window === 'undefined') return pixelId !== ''
  try {
    const boot = pixelBoot()
    const decision = decideEligibility(boot.eligible, pixelId)
    boot.eligible = decision.pinned
    return decision.allowed
  } catch {
    return false
  }
}

/** بيتنادى مع كل مسار (MetaPixelLoader): المرور بمسار محجوب بيلوّث المستند لباقي عمره. */
export function markPixelPath(pathname: string): void {
  try {
    if (isBlockedPath(pathname)) pixelBoot().visitedBlocked = true
    notePixelHref(false)
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
