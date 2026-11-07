/**
 * IMAGE-DELETE (C1) — حالات حذف الصورة وسلّم التراجع في الرفع بنتايج محاكاة (منطق خالص — pnpm --filter @zell/admin cases).
 * العقد: docs/contracts/IMAGE-DELETE.md §٣ و§٥-ج و§٥-د و§٧.
 */

import { exactImageId } from './imageId'
import {
  IMAGE_DELETE_MESSAGES,
  callImageDelete,
  type ImageDeleteArgs,
  IMAGE_DELETE_OWNER_ONLY_MESSAGE,
  IMAGE_DELETE_TEXT,
  imageDeleteBlock,
  imageDeleteDialogMessage,
  imageDeleteErrorCode,
  imageDeleteFailure,
  imageDeleteInputIssue,
  parseImageDeleteResult,
} from './deleteImage'
import {
  INSERT_UNCONFIRMED_MESSAGE,
  PRIMARY_CLEANUP_INCOMPLETE_MESSAGE,
  PRIMARY_UPLOAD_CANCELLED_MESSAGE,
  afterInsertUnconfirmed,
  afterPrimaryUnconfirmed,
  nonPrimaryDeleteQuery,
  type RollbackDeps,
} from './uploadRollback'

export type ImageCaseFailure = { name: string; expected: string; actual: string }

const failures: ImageCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

/**
 * داتابيز وتخزين مزيّفين لصف صورة واحد (المسار UUID بتاع الطلب ده). بيسجّلوا كل نداء بالترتيب.
 * deleteRows بيطبّق الشرط على الحالة الحالية للصف (زي جملة DELETE الواحدة في Postgres).
 */
type FakeState = { row: { id: string; isPrimary: boolean } | null; file: boolean; orphans: string[] }
function fake(state: FakeState, fail: { deleteRows?: boolean; deleteObject?: boolean; recordOrphan?: boolean } = {}) {
  const calls: string[] = []
  const deps: RollbackDeps = {
    deleteRows: async (query) => {
      calls.push('deleteRows ' + query)
      if (fail.deleteRows) throw new Error('rest down')
      const m = /^id=eq\.([0-9]+)&is_primary=is\.false$/.exec(query)
      if (m === null) throw new Error('unexpected query')
      if (state.row !== null && state.row.id === m[1] && !state.row.isPrimary) {
        state.row = null
        return 1
      }
      return 0
    },
    deleteObject: async (path) => {
      calls.push('deleteObject ' + path)
      if (fail.deleteObject) throw new Error('storage down')
      state.file = false
    },
    recordOrphan: async (path) => {
      calls.push('recordOrphan ' + path)
      if (fail.recordOrphan) throw new Error('rest down')
      state.orphans.push(path)
    },
  }
  return { deps, calls }
}

const PATH = 'products/7/0b7e1f6a-2c55-4f0e-9d7b-1a2b3c4d5e6f.webp'

export async function runImageCases(): Promise<{ passed: number; failures: ImageCaseFailure[] }> {
  // ── النصوص والقفل ─────────────────────────────────────────
  check('I01 owner-only wrapper message (image delete, formal Arabic)', IMAGE_DELETE_OWNER_ONLY_MESSAGE, 'حذف الصور متاح للمالك فقط.')
  check('I02 dialog texts = contract §٧', [IMAGE_DELETE_TEXT.title, IMAGE_DELETE_TEXT.confirm, IMAGE_DELETE_TEXT.message], [
    'حذف الصورة؟',
    'احذف',
    'ستُزال الصورة من المنتج. يبقى ملفها في التخزين إلى أن يُنظَّف لاحقًا. لا يمكن التراجع عن هذا الإجراء.',
  ])
  check('I03 dialog: the promotion line only for a primary image with another gallery image', [
    imageDeleteDialogMessage({ isPrimary: true, galleryCount: 3 }),
    imageDeleteDialogMessage({ isPrimary: true, galleryCount: 1 }),
    imageDeleteDialogMessage({ isPrimary: false, galleryCount: 3 }),
  ], [
    IMAGE_DELETE_TEXT.message + ' ستصبح أول صورة متبقية في المعرض هي الصورة الرئيسية.',
    IMAGE_DELETE_TEXT.message,
    IMAGE_DELETE_TEXT.message,
  ])
  check('I04 button block: admin = owner only; visible product with its last image = hide first; otherwise open', [
    imageDeleteBlock({ isOwner: false, productActive: false, galleryCount: 5 }),
    imageDeleteBlock({ isOwner: true, productActive: true, galleryCount: 1 }),
    imageDeleteBlock({ isOwner: true, productActive: false, galleryCount: 1 }),
    imageDeleteBlock({ isOwner: true, productActive: true, galleryCount: 2 }),
  ], ['حذف الصور متاح للمالك فقط.', 'أخفِ المنتج أولًا لحذف آخر صورة.', null, null])

  // ── المدخلات والرد ────────────────────────────────────────
  check('I05 input: positive integer product id + digit-string image id only', [
    imageDeleteInputIssue(7, '42'),
    imageDeleteInputIssue(0, '42'),
    imageDeleteInputIssue(7.5, '42'),
    imageDeleteInputIssue(7, 42),
    imageDeleteInputIssue(7, '0'),
    imageDeleteInputIssue(7, '4a'),
    imageDeleteInputIssue(7, ''),
  ], [null, IMAGE_DELETE_MESSAGES.invalid, IMAGE_DELETE_MESSAGES.invalid, IMAGE_DELETE_MESSAGES.invalid, IMAGE_DELETE_MESSAGES.invalid, IMAGE_DELETE_MESSAGES.invalid, IMAGE_DELETE_MESSAGES.invalid])
  check('I06 parse the reply (jsonb numbers or strings)', [
    parseImageDeleteResult({ deleted_image_id: 42, promoted_image_id: 43, orphan_recorded: true }, '42'),
    parseImageDeleteResult({ deleted_image_id: '42', promoted_image_id: null, orphan_recorded: false }, '42'),
  ], [
    { deletedImageId: '42', promotedImageId: '43', orphanRecorded: true },
    { deletedImageId: '42', promotedImageId: null, orphanRecorded: false },
  ])
  check('I07 bad reply shapes = null', [
    parseImageDeleteResult(null, '42'),
    parseImageDeleteResult([{ deleted_image_id: 42 }], '42'),
    parseImageDeleteResult({ deleted_image_id: 41, promoted_image_id: null, orphan_recorded: true }, '42'),
    parseImageDeleteResult({ deleted_image_id: 42, promoted_image_id: 42, orphan_recorded: true }, '42'),
    parseImageDeleteResult({ deleted_image_id: 42, promoted_image_id: 'x', orphan_recorded: true }, '42'),
    parseImageDeleteResult({ deleted_image_id: 42, promoted_image_id: null, orphan_recorded: 'yes' }, '42'),
    parseImageDeleteResult({ deleted_image_id: 42, orphan_recorded: true }, '42'),
  ], [null, null, null, null, null, null, null])

  // ── الأخطاء (§٣) ──────────────────────────────────────────
  const map = (code: string) => imageDeleteFailure({ code, message: 'x' }, 400)
  check('I08 error codes -> panel results', [
    map('45400'), map('45401'), map('45402'), map('45701'), map('45702'), map('45703'), map('45704'),
  ], [
    { code: 'UNAUTHENTICATED', message: IMAGE_DELETE_MESSAGES.unauthenticated },
    { code: 'FORBIDDEN', message: 'حذف الصور متاح للمالك فقط.' },
    { code: 'FORBIDDEN', message: 'حذف الصور متاح للمالك فقط.' },
    { code: 'NOT_FOUND', message: IMAGE_DELETE_MESSAGES.notFound },
    { code: 'VALIDATION', message: 'أخفِ المنتج أولًا لحذف آخر صورة.' },
    { code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.orphanConflict },
    { code: 'VALIDATION', message: 'يتم تعديل صور هذا المنتج حاليًا. حاول مرة أخرى بعد لحظات.' },
  ])
  check('I09 sentinel names in message are recognised; unknown codes are not', [
    imageDeleteErrorCode({ message: 'ZELL_IMAGE_BUSY' }),
    imageDeleteErrorCode({ message: 'ZELL_IMAGE_LAST_VISIBLE: product 7' }),
    imageDeleteErrorCode({ code: 'P0001', message: 'boom' }),
    imageDeleteErrorCode('45701'),
  ], ['45704', '45702', null, null])
  check('I10 unknown error = INTERNAL (outcome unknown); HTTP 401 without a code = UNAUTHENTICATED', [
    imageDeleteFailure({ code: '57014', message: 'canceling statement' }, 500),
    imageDeleteFailure(null, 401),
  ], [
    { code: 'INTERNAL', message: 'تعذّر تأكيد حذف الصورة. حدّث الصفحة وراجع صور المنتج.' },
    { code: 'UNAUTHENTICATED', message: IMAGE_DELETE_MESSAGES.unauthenticated },
  ])

  // ── سلّم التراجع في الرفع (§٥-ج / §٥-د) ─────────────────────
  check('U01 conditional delete query = id + is_primary=is.false', nonPrimaryDeleteQuery('42'), 'id=eq.42&is_primary=is.false')

  {
    // §٥-د: الإدخال فشل فعلًا (مفيش صف): الملف بيتسجّل بس، ومفيش مسح
    const state: FakeState = { row: null, file: true, orphans: [] }
    const f = fake(state)
    const res = await afterInsertUnconfirmed(PATH, f.deps)
    check('U02 insert failed: file never deleted, recorded insert_failed, new message', { res, calls: f.calls, state }, {
      res: { message: INSERT_UNCONFIRMED_MESSAGE, removedRows: 0, file: 'recorded' },
      calls: ['recordOrphan ' + PATH],
      state: { row: null, file: true, orphans: [PATH] },
    })
  }
  {
    // §٥-د السيناريو: الإدخال اتعمل له commit والرد ضاع، ودالة الحذف (0026) رقّت الصورة الجديدة رئيسية
    const state: FakeState = { row: { id: '42', isPrimary: true }, file: true, orphans: [] }
    const f = fake(state)
    const res = await afterInsertUnconfirmed(PATH, f.deps)
    check('U03 lost insert reply + promotion by the delete function: the primary row keeps its file', { res, calls: f.calls, state }, {
      res: { message: INSERT_UNCONFIRMED_MESSAGE, removedRows: 0, file: 'recorded' },
      calls: ['recordOrphan ' + PATH],
      state: { row: { id: '42', isPrimary: true }, file: true, orphans: [PATH] },
    })
  }
  {
    const state: FakeState = { row: null, file: true, orphans: [] }
    const f = fake(state, { recordOrphan: true })
    const res = await afterInsertUnconfirmed(PATH, f.deps)
    check('U04 insert failed and recording failed: file kept, still no delete', { res, calls: f.calls, file: state.file }, {
      res: { message: INSERT_UNCONFIRMED_MESSAGE, removedRows: 0, file: 'kept' },
      calls: ['recordOrphan ' + PATH],
      file: true,
    })
  }
  {
    // §٥-ج: التعيين اتعمل له commit والرد ضاع — الصف رئيسية، فالجملة المشروطة بتمسح صفر
    const state: FakeState = { row: { id: '42', isPrimary: true }, file: true, orphans: [] }
    const f = fake(state)
    const res = await afterPrimaryUnconfirmed('42', PATH, f.deps)
    check('U05 lost set-primary reply: zero rows deleted, file untouched and not recorded', { res, calls: f.calls, state }, {
      res: { message: PRIMARY_CLEANUP_INCOMPLETE_MESSAGE, removedRows: 0, file: 'kept' },
      calls: ['deleteRows id=eq.42&is_primary=is.false'],
      state: { row: { id: '42', isPrimary: true }, file: true, orphans: [] },
    })
  }
  {
    // §٥-ج: التعيين فشل فعلًا — الصف مش رئيسية، فبيتمسح والملف بعده
    const state: FakeState = { row: { id: '42', isPrimary: false }, file: true, orphans: [] }
    const f = fake(state)
    const res = await afterPrimaryUnconfirmed('42', PATH, f.deps)
    check('U06 set-primary really failed: exactly one row deleted, then the file', { res, calls: f.calls, state }, {
      res: { message: PRIMARY_UPLOAD_CANCELLED_MESSAGE, removedRows: 1, file: 'deleted' },
      calls: ['deleteRows id=eq.42&is_primary=is.false', 'deleteObject ' + PATH],
      state: { row: null, file: false, orphans: [] },
    })
  }
  {
    // الصف اتحذف بدالة الحذف في نفس اللحظة (هي اللي سجّلت الملف): الجملة بتلاقي صفر
    const state: FakeState = { row: null, file: true, orphans: [] }
    const f = fake(state)
    const res = await afterPrimaryUnconfirmed('42', PATH, f.deps)
    check('U07 row already deleted by the delete function: zero rows, file untouched', { res, file: state.file, calls: f.calls.length }, {
      res: { message: PRIMARY_CLEANUP_INCOMPLETE_MESSAGE, removedRows: 0, file: 'kept' },
      file: true,
      calls: 1,
    })
  }
  {
    const state: FakeState = { row: { id: '42', isPrimary: false }, file: true, orphans: [] }
    const f = fake(state, { deleteRows: true })
    const res = await afterPrimaryUnconfirmed('42', PATH, f.deps)
    check('U08 delete call itself failed: -1, file untouched and not recorded', { res, calls: f.calls, state }, {
      res: { message: PRIMARY_CLEANUP_INCOMPLETE_MESSAGE, removedRows: -1, file: 'kept' },
      calls: ['deleteRows id=eq.42&is_primary=is.false'],
      state: { row: { id: '42', isPrimary: false }, file: true, orphans: [] },
    })
  }
  {
    const state: FakeState = { row: { id: '42', isPrimary: false }, file: true, orphans: [] }
    const f = fake(state, { deleteObject: true })
    const res = await afterPrimaryUnconfirmed('42', PATH, f.deps)
    check('U09 one row deleted, file delete failed: file recorded for cleanup', { res, calls: f.calls, orphans: state.orphans }, {
      res: { message: PRIMARY_UPLOAD_CANCELLED_MESSAGE, removedRows: 1, file: 'recorded' },
      calls: ['deleteRows id=eq.42&is_primary=is.false', 'deleteObject ' + PATH, 'recordOrphan ' + PATH],
      orphans: [PATH],
    })
  }

  // ── B1: معرّفات bigint دقيقة (9007199254740992 و9007199254740993 متجاورين وبرّه المدى الآمن) ──────
  const BIG_A = '9007199254740992'
  const BIG_B = '9007199254740993'
  const rounded: unknown = (JSON.parse('{"id":' + BIG_B + '}') as { id: unknown }).id
  check('B01 exact ids: digit text kept as is; a rounded JSON number is rejected (never turned into a neighbour id)', [
    exactImageId(BIG_B),
    exactImageId(BIG_A),
    exactImageId(rounded),
    exactImageId(9007199254740991),
    exactImageId('9223372036854775808'),
    exactImageId('0042'),
  ], [BIG_B, BIG_A, null, '9007199254740991', null, null])
  check('B02 the rounded number really equals the neighbour (why String() after JSON.parse is unsafe)', String(rounded), BIG_A)

  // ── نداء الحذف (callImageDelete = المسار الفعلي؛ imageDelete.ts بيوصّل جلسة المستخدم بس) ──────
  type Call = { args: ImageDeleteArgs; aborted: boolean }
  function rpcOf(reply: () => Promise<{ data: unknown; error: unknown; status: number }>) {
    const calls: Call[] = []
    const rpc = async (args: ImageDeleteArgs, signal: AbortSignal) => {
      calls.push({ args, aborted: signal.aborted })
      return reply()
    }
    return { rpc, calls }
  }
  {
    const f1 = rpcOf(async () => ({ data: { deleted_image_id: BIG_B, promoted_image_id: null, orphan_recorded: true }, error: null, status: 200 }))
    const res = await callImageDelete(f1.rpc, 7, BIG_B)
    check('D01 one call with the exact parameters (product number, image id as exact text); reply with text id = success', { res, calls: f1.calls }, {
      res: { ok: true, data: { deletedImageId: BIG_B, promotedImageId: null, orphanRecorded: true } },
      calls: [{ args: { p_product_id: 7, p_image_id: BIG_B }, aborted: false }],
    })
  }
  {
    // supabase-js بيفك الرد بـ JSON.parse: jsonb رقم برّه المدى الآمن بيوصل مقرّب
    const data: unknown = JSON.parse('{"deleted_image_id":' + BIG_B + ',"promoted_image_id":null,"orphan_recorded":true}')
    const f2 = rpcOf(async () => ({ data, error: null, status: 200 }))
    const res = await callImageDelete(f2.rpc, 7, BIG_B)
    check('D02 reply with a rounded id = unconfirmed (INTERNAL), not success for another image; still one call', { res, n: f2.calls.length }, {
      res: { ok: false, code: 'INTERNAL', message: IMAGE_DELETE_MESSAGES.internal },
      n: 1,
    })
  }
  {
    const f3 = rpcOf(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const res = await callImageDelete(f3.rpc, 7, '42')
    check('D03 lost reply (timeout) = unconfirmed INTERNAL, exactly one call, no retry', { res, n: f3.calls.length }, {
      res: { ok: false, code: 'INTERNAL', message: 'تعذّر تأكيد حذف الصورة. حدّث الصفحة وراجع صور المنتج.' },
      n: 1,
    })
  }
  {
    // نفس شكل خطأ PostgREST في supabase-js (PostgrestError)
    const f4 = rpcOf(async () => ({ data: null, error: { code: '45704', details: null, hint: null, message: 'ZELL_IMAGE_BUSY' }, status: 400 }))
    const f5 = rpcOf(async () => ({ data: null, error: { code: '45702', details: null, hint: null, message: 'ZELL_IMAGE_LAST_VISIBLE' }, status: 400 }))
    const f6 = rpcOf(async () => ({ data: null, error: { code: '45402', details: null, hint: null, message: 'ZELL_ORD_OWNER_ONLY' }, status: 400 }))
    check('D04 PostgREST-shaped refusals -> busy / hide first / owner only, one call each', [
      await callImageDelete(f4.rpc, 7, '42'),
      await callImageDelete(f5.rpc, 7, '42'),
      await callImageDelete(f6.rpc, 7, '42'),
      f4.calls.length + f5.calls.length + f6.calls.length,
    ], [
      { ok: false, code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.busy },
      { ok: false, code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.lastVisible },
      { ok: false, code: 'FORBIDDEN', message: IMAGE_DELETE_MESSAGES.forbidden },
      3,
    ])
  }
  {
    const f7 = rpcOf(async () => ({ data: null, error: null, status: 200 }))
    check('D05 invalid input (rounded number id, empty, zero product) = VALIDATION and no call at all', [
      await callImageDelete(f7.rpc, 7, rounded),
      await callImageDelete(f7.rpc, 7, ''),
      await callImageDelete(f7.rpc, 0, '42'),
      f7.calls.length,
    ], [
      { ok: false, code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.invalid },
      { ok: false, code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.invalid },
      { ok: false, code: 'VALIDATION', message: IMAGE_DELETE_MESSAGES.invalid },
      0,
    ])
  }

  return { passed, failures }
}
