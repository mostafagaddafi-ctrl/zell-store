/**
 * GALLERY-SWIPE — منطق خالص لتقليب صور المنتج بالسحب (docs/contracts/GALLERY-SWIPE.md). من غير DOM ولا I/O.
 *
 * - §٢: سحبة = |dx| ≥ 40px و|dx| ≥ 1.5 × |dy|، وتبديل واحد عند رفع الصباع. RTL زي الأسهم: الصباع لليمين (dx > 0) = التالية.
 * - §٣: لمس بس · اللمسة صاحبة السحبة لازم تكون primary (مفيش لمسة تانية شغالة في أي مكان) · cancel / lost = إلغاء ·
 *   صباع تاني من أي مكان = إلغاء لحد رفع كل الصوابع · مفيش بداية من على زرار ولا والصفحة متكبّرة.
 * - §٤: منع الـ click اللي جاي من نفس السحبة بس: لحد أول pointerdown أو keydown أو 600ms أو أول click، وعمره ما بيمنع
 *   click الكيبورد (detail = 0). بعد 600ms الحالة بتتصفّى (expire) والمتابعة بتتشال.
 * - الأحداث ممكن توصل مرتين (متابعة document + السطح نفسه)، فالـ reducer بيتجاهل down لمعرّف موجود وup لمعرّف مش موجود.
 * - createSwipeController: دورة حياة الالتقاط والمتابعة والمؤقت حوالين الـ reducer، من خلال host بيتحقن (المتصفح أو الاختبار).
 */

export const SWIPE_MIN_PX = 40
export const SWIPE_RATIO = 1.5
export const SWIPE_CLICK_WINDOW_MS = 600

export type SwipeCommand = 'next' | 'prev'

/** السحب متاح بس لو فيه أكتر من صورة (نفس شرط الأسهم). */
export function swipeEnabled(imageCount: number): boolean {
  return Number.isFinite(imageCount) && imageCount > 1
}

/** §٢ — dx > 0 (الصباع لليمين) = التالية · dx < 0 = السابقة · غير كده null. */
export function classifySwipe(dx: number, dy: number): SwipeCommand | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < SWIPE_MIN_PX) return null
  if (ax < SWIPE_RATIO * ay) return null
  return dx > 0 ? 'next' : 'prev'
}

export type SwipeState = {
  /** اللمسة صاحبة السحبة ونقطة بدايتها. */
  tracking: { id: number; x: number; y: number } | null
  /** معرّفات اللمسات الشغالة اللي شايفينها. */
  touches: number[]
  /** اتلغت بصباع تاني — مستنية رفع كل الصوابع. */
  blocked: boolean
  /** منع click السحبة لحد الوقت ده (ms)، أو null. */
  suppressUntil: number | null
}

export const IDLE_SWIPE: SwipeState = { tracking: null, touches: [], blocked: false, suppressUntil: null }

export type SwipeDown = {
  id: number
  pointerType: string
  x: number
  y: number
  /** false = فيه لمسة تانية شغالة في الصفحة (حتى لو برّه السطح) — مفيش بداية سحبة. */
  isPrimary: boolean
  onSurface: boolean
  onControl: boolean
  pageZoomed: boolean
}

export type SwipeEvent =
  | ({ type: 'down' } & SwipeDown)
  | { type: 'up'; id: number; pointerType: string; x: number; y: number; now: number }
  | { type: 'cancel'; id: number; pointerType: string }
  | { type: 'lost'; id: number }
  | { type: 'key' }
  | { type: 'click'; now: number; detail: number }
  | { type: 'expire'; now: number }
  | { type: 'reset' }

export type SwipeResult = { state: SwipeState; command: SwipeCommand | null; preventClick: boolean }

/** الحالة فاضية = مفيش لزوم لمتابعة document. */
export function isSwipeIdle(state: SwipeState): boolean {
  return state.tracking === null && state.touches.length === 0 && !state.blocked && state.suppressUntil === null
}

function result(state: SwipeState, command: SwipeCommand | null = null, preventClick = false): SwipeResult {
  return { state, command, preventClick }
}

function released(state: SwipeState, id: number): SwipeState {
  const touches = state.touches.filter((touch) => touch !== id)
  return { ...state, touches, blocked: state.blocked && touches.length > 0 }
}

export function reduceSwipe(state: SwipeState, event: SwipeEvent): SwipeResult {
  switch (event.type) {
    case 'reset':
      return result(IDLE_SWIPE)

    case 'key':
      return result({ ...state, suppressUntil: null })

    case 'expire':
      if (state.suppressUntil === null || event.now <= state.suppressUntil) return result(state)
      return result({ ...state, suppressUntil: null })

    case 'click': {
      if (state.suppressUntil === null) return result(state)
      const prevent = event.detail > 0 && event.now <= state.suppressUntil
      return result({ ...state, suppressUntil: null }, null, prevent)
    }

    case 'down': {
      // أي ضغطة جديدة (لمس أو ماوس أو قلم) = تفاعل جديد، فمنع click السحبة اللي فاتت بيتلغي
      const cleared: SwipeState = { ...state, suppressUntil: null }
      if (event.pointerType !== 'touch') return result(cleared)
      if (cleared.touches.includes(event.id)) return result(cleared) // نفس الحدث وصل مرتين
      const touches = [...cleared.touches, event.id]
      if (cleared.tracking !== null || cleared.touches.length > 0 || cleared.blocked) {
        return result({ ...cleared, touches, tracking: null, blocked: true })
      }
      const canStart = event.isPrimary && event.onSurface && !event.onControl && !event.pageZoomed
      return result({ ...cleared, touches, tracking: canStart ? { id: event.id, x: event.x, y: event.y } : null })
    }

    case 'up': {
      if (event.pointerType !== 'touch' || !state.touches.includes(event.id)) return result(state)
      const tracking = state.tracking
      const next = released({ ...state, tracking: tracking !== null && tracking.id === event.id ? null : tracking }, event.id)
      if (tracking === null || tracking.id !== event.id || state.blocked) return result(next)
      const command = classifySwipe(event.x - tracking.x, event.y - tracking.y)
      if (command === null) return result(next)
      return result({ ...next, suppressUntil: event.now + SWIPE_CLICK_WINDOW_MS }, command)
    }

    case 'cancel': {
      if (event.pointerType !== 'touch' || !state.touches.includes(event.id)) return result(state)
      const tracking = state.tracking !== null && state.tracking.id === event.id ? null : state.tracking
      return result(released({ ...state, tracking }, event.id))
    }

    case 'lost': {
      if (state.tracking === null || state.tracking.id !== event.id) return result(state)
      return result({ ...state, tracking: null })
    }
  }
}

// ── دورة الحياة (الالتقاط · المتابعة · المؤقت) ─────────────────────

/** اللي الـ controller محتاجه من المتصفح (أو من الاختبار). */
export type SwipeHost = {
  /** setPointerCapture على السطح. */
  capture: (id: number) => void
  /** releasePointerCapture لو الالتقاط لسه قايم. */
  release: (id: number) => void
  /** تركيب (true) أو شيل (false) متابعة document. بيتنادى بس لما الحالة تتغيّر. */
  listen: (on: boolean) => void
  command: (command: SwipeCommand) => void
  now: () => number
  /** بعد ms يتنادى expire()؛ cancel = يلغي أي مؤقت قايم. */
  schedule: (ms: number) => void
  cancelSchedule: () => void
}

export type SwipeController = {
  surfaceDown: (event: Omit<SwipeDown, 'onSurface'>) => void
  documentDown: (event: SwipeDown) => void
  up: (event: { id: number; pointerType: string; x: number; y: number }) => void
  cancel: (event: { id: number; pointerType: string }) => void
  lost: (id: number) => void
  key: () => void
  /** true = امنع الـ click ده (preventDefault + stopPropagation). */
  click: (detail: number) => boolean
  expire: () => void
  reset: () => void
  /** للاختبار. */
  snapshot: () => { state: SwipeState; captured: number | null; listening: boolean }
}

/**
 * - الالتقاط له هوية لوحده (captured)، مش من tracking: أول ما السحبة تبطل (رفع · إلغاء · صباع تاني · lost · reset)
 *   الالتقاط بيتفك على طول.
 * - المتابعة شغالة بالظبط طول ما الحالة مش فاضية.
 * - بعد سحبة ناجحة مؤقت 600ms+1 بيصفّي منع الـ click لو مفيش حدث جه.
 */
export function createSwipeController(host: SwipeHost): SwipeController {
  let state: SwipeState = IDLE_SWIPE
  let captured: number | null = null
  let listening = false

  function sync(surfaceDownId: number | null): void {
    const tracking = state.tracking
    if (captured !== null && (tracking === null || tracking.id !== captured)) {
      const id = captured
      captured = null
      host.release(id)
    }
    if (surfaceDownId !== null && captured === null && tracking !== null && tracking.id === surfaceDownId) {
      captured = surfaceDownId
      host.capture(surfaceDownId)
    }
    const want = !isSwipeIdle(state)
    if (want !== listening) {
      listening = want
      host.listen(want)
    }
  }

  function dispatch(event: SwipeEvent, surfaceDownId: number | null = null): boolean {
    const out = reduceSwipe(state, event)
    state = out.state
    sync(surfaceDownId)
    if (out.command !== null) {
      host.schedule(SWIPE_CLICK_WINDOW_MS + 1)
      host.command(out.command)
    }
    return out.preventClick
  }

  return {
    surfaceDown: (event) => {
      dispatch({ type: 'down', ...event, onSurface: true }, event.id)
    },
    documentDown: (event) => {
      dispatch({ type: 'down', ...event })
    },
    up: (event) => {
      dispatch({ type: 'up', ...event, now: host.now() })
    },
    cancel: (event) => {
      dispatch({ type: 'cancel', ...event })
    },
    lost: (id) => {
      dispatch({ type: 'lost', id })
    },
    key: () => {
      dispatch({ type: 'key' })
    },
    click: (detail) => dispatch({ type: 'click', now: host.now(), detail }),
    expire: () => {
      dispatch({ type: 'expire', now: host.now() })
    },
    reset: () => {
      host.cancelSchedule()
      dispatch({ type: 'reset' })
    },
    snapshot: () => ({ state, captured, listening }),
  }
}
