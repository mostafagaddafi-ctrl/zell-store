/**
 * BUY-NOW (أمر المالك 2026-10-28): «اطلب دلوقتي» من غير انتظار من غير علامة، ومن غير تكرار في السلة.
 *
 * آلة حالة خالصة (من غير React) — الهوك components/store/useBuyNow.ts بيشغّلها:
 * - أول ضغطة بعد التحقق من الاختيار = إضافة مرة واحدة + انتقال لـ /checkout، والحالة «بينتقل».
 * - أي ضغطة وهو «بينتقل» = ولا حاجة (لا إضافة ولا انتقال). و«ضيف للسلة» مقفول وقتها.
 * - الانتقال ماخلصش في BUY_NOW_TIMEOUT_MS = «فشل»: الصنف فاضل في السلة، وإعادة المحاولة بنفس الاختيار = انتقال بس.
 * - الصفحة رجعت من كاش المتصفح (bfcache) وهي «بينتقل» = الأزرار ترجع شغّالة، ونفس الاختيار مايتضافش تاني.
 * - «ضيف للسلة» لنفس الاختيار قبلها (alreadyInCart) = انتقال بس، زي السلوك القديم بالظبط.
 * الأسعار والمقاس والسلة نفسها ماتغيّروش. الحالات: buyNow.cases.ts (suite buy-now).
 */

export const BUY_NOW_TIMEOUT_MS = 15000
export const BUY_NOW_PENDING_TEXT = 'جارٍ الانتقال لبيانات الطلب…'
export const BUY_NOW_FAILED_TEXT = 'ماقدرناش نفتح صفحة بيانات الطلب. اتأكد من الإنترنت واضغط «اطلب دلوقتي» تاني — الطلب مش هيتكرر في السلة.'

export type BuyNowPhase = 'idle' | 'navigating' | 'failed'
export type BuyNowState = { phase: BuyNowPhase; addedKey: string | null }
export const BUY_NOW_INITIAL: BuyNowState = { phase: 'idle', addedKey: null }

export type BuyNowStep = { add: boolean; navigate: boolean; next: BuyNowState }

/** ضغطة على «اطلب دلوقتي» بعد ما الاختيار اتحقق. key = لقطة الاختيار. alreadyInCart = «ضيف للسلة» لنفس الاختيار لسه. */
export function buyNowClick(state: BuyNowState, key: string, alreadyInCart: boolean): BuyNowStep {
  if (state.phase === 'navigating') return { add: false, navigate: false, next: state }
  const add = !alreadyInCart && state.addedKey !== key
  return { add, navigate: true, next: { phase: 'navigating', addedKey: key } }
}

/** الانتقال ماخلصش في المدة = فشل (اللي اتضاف فاضل). */
export function buyNowTimeout(state: BuyNowState): BuyNowState {
  return state.phase === 'navigating' ? { phase: 'failed', addedKey: state.addedKey } : state
}

/** رجوع الصفحة من كاش المتصفح وهي لسه «بينتقل» = الأزرار ترجع شغّالة، من غير نسيان اللي اتضاف. */
export function buyNowRestored(state: BuyNowState): BuyNowState {
  return state.phase === 'navigating' ? { phase: 'idle', addedKey: state.addedKey } : state
}

/** وقت الانتقال: أزرار الشراء (الاتنين) مقفولة. */
export function buyNowBusy(state: BuyNowState): boolean {
  return state.phase === 'navigating'
}
