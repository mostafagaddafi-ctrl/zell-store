/**
 * GALLERY-SWIPE — حالات السحب (pnpm --filter @zell/storefront cases، suite gallery). العقد §٧.
 */

import {
  IDLE_SWIPE,
  SWIPE_CLICK_WINDOW_MS,
  SWIPE_MIN_PX,
  SWIPE_RATIO,
  classifySwipe,
  isSwipeIdle,
  reduceSwipe,
  swipeEnabled,
  type SwipeEvent,
  type SwipeState,
} from './swipe'

export type GalleryCaseFailure = { name: string; expected: string; actual: string }

const failures: GalleryCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/** بيشغّل الأحداث بالترتيب، وبيرجّع الأوامر ونتيجة كل click والحالة الأخيرة. */
function run(events: SwipeEvent[]): { commands: string[]; clicks: boolean[]; state: SwipeState } {
  let state = IDLE_SWIPE
  const commands: string[] = []
  const clicks: boolean[] = []
  for (const event of events) {
    const out = reduceSwipe(state, event)
    state = out.state
    if (out.command !== null) commands.push(out.command)
    if (event.type === 'click') clicks.push(out.preventClick)
  }
  return { commands, clicks, state }
}

type DownOpts = { type?: string; onSurface?: boolean; onControl?: boolean; pageZoomed?: boolean }
const down = (id: number, x: number, y: number, opts: DownOpts = {}): SwipeEvent => ({
  type: 'down',
  id,
  pointerType: opts.type ?? 'touch',
  x,
  y,
  onSurface: opts.onSurface ?? true,
  onControl: opts.onControl ?? false,
  pageZoomed: opts.pageZoomed ?? false,
})
const up = (id: number, x: number, y: number, now = 1000, type = 'touch'): SwipeEvent => ({ type: 'up', id, pointerType: type, x, y, now })
const click = (now = 1010, detail = 1): SwipeEvent => ({ type: 'click', now, detail })
const swipe = (dx: number, dy = 0, id = 1): SwipeEvent[] => [down(id, 200, 300), up(id, 200 + dx, 300 + dy)]

export function runGallerySwipeCases(): { passed: number; failures: GalleryCaseFailure[] } {
  // ── الثوابت والحدود (§٢) ──
  check('K01 constants', [SWIPE_MIN_PX, SWIPE_RATIO, SWIPE_CLICK_WINDOW_MS], [40, 1.5, 600])
  check('K02 enabled only with more than one image', [swipeEnabled(0), swipeEnabled(1), swipeEnabled(2), swipeEnabled(Number.NaN)], [false, false, true, false])
  check('C01 39px = no swipe · 40px = swipe', [classifySwipe(39, 0), classifySwipe(40, 0), classifySwipe(-39, 0), classifySwipe(-40, 0)], [null, 'next', null, 'prev'])
  check('C02 RTL: finger to the right = next · to the left = prev', [classifySwipe(80, 5), classifySwipe(-80, -5)], ['next', 'prev'])
  check('C03 ratio 1.5: dy 40 ok · dy 41 no (dx 60)', [classifySwipe(60, 40), classifySwipe(60, -40), classifySwipe(60, 41), classifySwipe(-60, -41)], ['next', 'next', null, null])
  check('C04 vertical and diagonal = no swipe', [classifySwipe(0, 120), classifySwipe(10, -200), classifySwipe(50, 50), classifySwipe(-70, 60)], [null, null, null, null])
  check('C05 non-finite = no swipe', [classifySwipe(Number.NaN, 0), classifySwipe(Number.POSITIVE_INFINITY, 0)], [null, null])

  // ── تسلسل الأحداث (§٣) ──
  check('S01 touch swipe right = one next', run(swipe(60)).commands, ['next'])
  check('S02 touch swipe left = one prev', run(swipe(-60)).commands, ['prev'])
  check('S03 short swipe (39px) = nothing', run(swipe(39)).commands, [])
  check('S04 mouse and pen = nothing', [
    run([down(1, 200, 300, { type: 'mouse' }), up(1, 300, 300, 1000, 'mouse')]).commands,
    run([down(1, 200, 300, { type: 'pen' }), up(1, 300, 300, 1000, 'pen')]).commands,
  ], [[], []])
  check('S05 start on a button/link = nothing', run([down(1, 200, 300, { onControl: true }), up(1, 300, 300)]).commands, [])
  check('S06 page already zoomed = nothing', run([down(1, 200, 300, { pageZoomed: true }), up(1, 300, 300)]).commands, [])
  check('S07 pointercancel = cancelled, later up ignored', run([down(1, 200, 300), { type: 'cancel', id: 1, pointerType: 'touch' }, up(1, 300, 300)]).commands, [])
  check('S08 lost capture = cancelled', run([down(1, 200, 300), { type: 'lost', id: 1 }, up(1, 300, 300)]).commands, [])
  const twoFingers = run([down(1, 200, 300), down(2, 100, 500, { onSurface: false }), up(1, 320, 300), up(2, 100, 500)])
  check('S09 second finger (even outside the surface) = cancelled until all fingers lift', [twoFingers.commands, isSwipeIdle(twoFingers.state)], [[], true])
  const liftOne = run([down(1, 200, 300), down(2, 260, 300), up(2, 260, 300), up(1, 330, 300)])
  check('S10 lifting one finger after a pinch is not a swipe', liftOne.commands, [])
  const blockedUntilAll = run([down(1, 200, 300), down(2, 260, 300), up(2, 260, 300), down(3, 200, 300), up(3, 300, 300)])
  check('S11 still blocked while a finger is down (new finger does not start)', blockedUntilAll.commands, [])
  const afterAll = run([down(1, 200, 300), down(2, 260, 300), up(1, 200, 300), up(2, 260, 300), ...swipe(70, 0, 3)])
  check('S12 new touch after all fingers lifted works normally', afterAll.commands, ['next'])
  check('S13 up for an unknown id = nothing', run([down(1, 200, 300), up(9, 400, 300)]).commands, [])
  check('S14 duplicate down (document + surface) does not block', run([down(1, 200, 300), down(1, 200, 300), up(1, 280, 300)]).commands, ['next'])
  check('S15 duplicate up = one command only', run([down(1, 200, 300), up(1, 280, 300), up(1, 280, 300)]).commands, ['next'])
  check('S16 reset clears everything', isSwipeIdle(run([down(1, 200, 300), down(2, 10, 10), { type: 'reset' }]).state), true)
  check('S17 idle after a plain tap', isSwipeIdle(run([down(1, 200, 300), up(1, 202, 301), click()]).state), true)

  // ── منع الـ click (§٤) ──
  check('P01 successful swipe = command + its click blocked once only', run([...swipe(60), click(1010), click(1020)]), {
    commands: ['next'],
    clicks: [true, false],
    state: IDLE_SWIPE,
  })
  check('P02 failed swipe = click not blocked', run([...swipe(20), click()]).clicks, [false])
  check('P03 new touch cancels the block', run([...swipe(60), down(2, 50, 50), up(2, 50, 50, 1005), click(1006)]).clicks, [false])
  check('P04 swipe without a click, then a mouse press = passes', run([...swipe(60), down(5, 10, 10, { type: 'mouse' }), click(1100)]).clicks, [false])
  check('P05 keyboard click (detail 0) after a swipe = passes', run([...swipe(60), click(1010, 0)]).clicks, [false])
  check('P06 keydown cancels the block', run([...swipe(60), { type: 'key' }, click(1010)]).clicks, [false])
  check('P07 click after 600ms = passes · at 600ms = blocked', [run([...swipe(60), click(1000 + 601)]).clicks, run([...swipe(60), click(1000 + 600)]).clicks], [[false], [true]])
  check('P08 zoom backdrop: tap after a swipe (new down) closes normally', run([...swipe(-60), down(2, 5, 5, { onSurface: false }), up(2, 5, 5, 1200), click(1201)]).clicks, [false])

  return { passed, failures }
}
