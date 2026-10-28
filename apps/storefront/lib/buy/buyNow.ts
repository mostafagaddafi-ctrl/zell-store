/**
 * BUY-NOW (أمر المالك 2026-10-28، المراجعة 1): «اطلب دلوقتي» من غير انتظار من غير علامة، ومن غير تكرار في السلة.
 *
 * آلة حالة خالصة (من غير React) — الهوك components/store/useBuyNow.ts بيشغّلها:
 * - idle ← أول ضغطة بعد التحقق: السطر يتضاف مرة واحدة (لو مااتضافش قبل كده بنفس الاختيار)، والإضافات المختارة
 *   دلوقتي تتضاف، وانتقال عادي لـ /checkout ← navigating.
 * - navigating / slow / reloading = «مشغول»: أي ضغطة مالهاش أثر، و«ضيف للسلة» وكل خانات الاختيار (المقاس · العرض ·
 *   الإضافات · الكمية · الفني) مقفولة، فاللي ظاهر هو بالظبط اللي اتضاف. مفيش حاجة بتتفك لوحدها.
 * - بعد BUY_NOW_SLOW_MS من غير انتقال ← slow: **تنبيه بس، مش فشل** — الانتقال الأصلي ممكن لسه يكمّل ويوصل عادي.
 *   الحماية فاضلة، ومعاها زرار «افتح صفحة بيانات الطلب».
 * - retry في slow ← reloading: تحميل كامل لـ /checkout (من غير أي إضافة). سياسة العملية الأصلية: مابتتلغيش؛ أيهما وصل
 *   الأول بيفتح نفس الصفحة، والسلة محفوظة قبلها (localStorage)، فمفيش تكرار في الحالتين.
 * - رجوع الصفحة من كاش المتصفح (bfcache) وهي مشغولة ← idle، من غير نسيان السطر اللي اتضاف (ضغطة بنفس الاختيار =
 *   انتقال بس، وأي إضافات اتختارت بعد الرجوع بتتضاف لأنها ظاهرة مختارة).
 * الأسعار والمقاس والسلة نفسها ماتغيّروش. الحالات: buyNow.cases.ts (suite buy-now).
 */

export const BUY_NOW_SLOW_MS = 15000
export const BUY_NOW_PENDING_TEXT = 'جارٍ الانتقال لبيانات الطلب…'
export const BUY_NOW_SLOW_TEXT = 'التحميل بياخد وقت أطول من العادي. طلبك اتضاف للسلة مرة واحدة ومش هيتكرر.'
export const BUY_NOW_RETRY_LABEL = 'افتح صفحة بيانات الطلب'

export type BuyNowPhase = 'idle' | 'navigating' | 'slow' | 'reloading'
export type BuyNowState = { phase: BuyNowPhase; addedKey: string | null }
export const BUY_NOW_INITIAL: BuyNowState = { phase: 'idle', addedKey: null }

export type BuyNowNavigation = 'none' | 'soft' | 'hard'
export type BuyNowStep = { addLine: boolean; addExtras: boolean; navigate: BuyNowNavigation; next: BuyNowState }

const NOTHING = (state: BuyNowState): BuyNowStep => ({ addLine: false, addExtras: false, navigate: 'none', next: state })

/** مشغول = أزرار الشراء وخانات الاختيار مقفولة. */
export function buyNowBusy(state: BuyNowState): boolean {
  return state.phase !== 'idle'
}

/** ضغطة «اطلب دلوقتي» بعد ما الاختيار اتحقق. key = لقطة السطر. alreadyInCart = «ضيف للسلة» لنفس السطر لسه. */
export function buyNowClick(state: BuyNowState, key: string, alreadyInCart: boolean): BuyNowStep {
  if (buyNowBusy(state)) return NOTHING(state)
  return {
    addLine: !alreadyInCart && state.addedKey !== key,
    addExtras: true,
    navigate: 'soft',
    next: { phase: 'navigating', addedKey: key },
  }
}

/** مرّت BUY_NOW_SLOW_MS والانتقال لسه ماخلصش = تنبيه (الحماية فاضلة). */
export function buyNowSlow(state: BuyNowState): BuyNowState {
  return state.phase === 'navigating' ? { phase: 'slow', addedKey: state.addedKey } : state
}

/** «افتح صفحة بيانات الطلب» في حالة التنبيه = تحميل كامل للصفحة، من غير إضافة. أي حالة تانية = ولا حاجة. */
export function buyNowRetry(state: BuyNowState): BuyNowStep {
  if (state.phase !== 'slow') return NOTHING(state)
  return { addLine: false, addExtras: false, navigate: 'hard', next: { phase: 'reloading', addedKey: state.addedKey } }
}

/** رجوع من كاش المتصفح وهي مشغولة = الأزرار ترجع شغّالة، من غير نسيان اللي اتضاف. */
export function buyNowRestored(state: BuyNowState): BuyNowState {
  return buyNowBusy(state) ? { phase: 'idle', addedKey: state.addedKey } : state
}
