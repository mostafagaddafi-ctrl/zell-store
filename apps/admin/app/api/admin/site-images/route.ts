import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminAction } from '../../../../lib/auth/guards'
import { guardMutations } from '../../../../lib/mutations'
import { uploadSiteImage } from '../../../../lib/mutations/siteImageUpload'
import { REVALIDATION_WARNING, revalidateStorefront } from '../../../../lib/revalidateStorefront'

/**
 * POST /api/admin/site-images
 *
 * الراوت ده **مش** بروكسي Storage: مابياخدش bucket ولا مسار ولا اسم
 * ملف. بياخد نوع وبايتات ونص بديل، والباقي بيتحدد في السيرفر.
 *
 * ترتيب الفحوص مقصود: **الصلاحية قبل أي لمس للجسم** — قراءة جسم
 * multipart معناها تحميله في الرام، وده مش شيء نعمله لمجهول.
 */
export const dynamic = 'force-dynamic'

/**
 * رفض مبكر من content-length.
 * ⚠️ content-length بتاع multipart بيشمل الحدود والهيدرات، فهو **مش**
 * حجم الملف. المرجع الحقيقي هو عدد البايتات بعد التحليل.
 */
const EARLY_REQUEST_CAP = 5_500_000

const CODE_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const outcome = await uploadSiteImage({
    kind: form.get('kind'),
    altText: form.get('altText'),
    bytes,
  })

  if (outcome.result.ok) {
    const refreshed = await revalidateStorefront()
    if (!refreshed) {
      return NextResponse.json({ ...outcome.result, warning: REVALIDATION_WARNING }, { status: outcome.status })
    }
  }
  return NextResponse.json(outcome.result, { status: outcome.status })
}
