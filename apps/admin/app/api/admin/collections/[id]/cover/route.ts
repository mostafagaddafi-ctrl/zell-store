import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminAction } from '../../../../../../lib/auth/guards'
import { guardMutations } from '../../../../../../lib/mutations'
import { uploadCollectionCover } from '../../../../../../lib/mutations/collectionCover'
import { REVALIDATION_WARNING, revalidateStorefront } from '../../../../../../lib/revalidateStorefront'

/**
 * POST /api/admin/collections/[id]/cover
 *
 * نفس عقد /api/admin/site-images: مابياخدش bucket ولا مسار ولا اسم
 * ملف — بايتات بس، والباقي بيتحدد في السيرفر.
 *
 * ترتيب الفحوص مقصود: **الصلاحية قبل أي لمس للجسم**.
 */
export const dynamic = 'force-dynamic'

/** رفض مبكر من content-length — مش حجم الملف، المرجع بعد التحليل. */
const EARLY_REQUEST_CAP = 5_500_000

const CODE_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdminAction()
  if (!auth.ok) {
    return NextResponse.json(auth, { status: CODE_STATUS[auth.code] ?? 403 })
  }

  const gate = guardMutations()
  if (gate) return NextResponse.json(gate, { status: 409 })

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > EARLY_REQUEST_CAP) {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'الطلب أكبر من المسموح. أقصى حجم للصورة ٤ ميجابايت.' },
      { status: 413 },
    )
  }

  const { id } = await context.params

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'الطلب مش مقروء. جرّب تاني.' },
      { status: 400 },
    )
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, code: 'VALIDATION', message: 'مفيش ملف مرفوع.' }, { status: 400 })
  }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return NextResponse.json(
      { ok: false, code: 'VALIDATION', message: 'قراءة الملف فشلت. جرّب تاني.' },
      { status: 400 },
    )
  }

  const outcome = await uploadCollectionCover({ collectionId: id, bytes })

  if (outcome.result.ok) {
    const refreshed = await revalidateStorefront()
    if (!refreshed) {
      return NextResponse.json({ ...outcome.result, warning: REVALIDATION_WARNING }, { status: outcome.status })
    }
  }
  return NextResponse.json(outcome.result, { status: outcome.status })
}
