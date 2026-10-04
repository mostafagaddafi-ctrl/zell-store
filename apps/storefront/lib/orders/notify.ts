import 'server-only'

/**
 * إشعار الطلب — ORDER-FLOW-PLAN.md §7.
 *
 * 🔒 قواعد ثابتة:
 *   • **الإشعار ما يوقّعش الطلب أبداً** (§7.1). بيتنفّذ جوه after() بعد ما الرد
 *     راح للعميل، وأي فشل = notify_error بس.
 *   • أسرار تليجرام من process.env **فقط**. ممنوع قراءتها من settings (ت١).
 *   • اللوج: رقم الطلب + كود داخلي + المدة. **مفيش** اسم ولا موبايل ولا عنوان
 *     ولا ملاحظات ولا توكن ولا رابط تليجرام كامل (§7.6).
 *   • ممنوع رمز الإيصال أو كوكي الجلسة في الرسالة أو في أي لوج.
 *   • ممنوع أي كتابة هنا تلمس receipt_expires_at (ب١٠).
 */

import { INSTALLATION_NOTE_MARKER, hasInstallerRequest } from '@zell/core'
import { restPatch, restSelect } from '../data/rpc'

const TELEGRAM_TIMEOUT_MS = 5000
const MAX_NOTIFY_ERROR = 200
const TIME_ZONE = 'Africa/Cairo'

type NotifyItem = {
  product_name_ar: string
  length_cm: number | null
  width_cm: number | null
  line_total_piastres: number
  /** 0016 */
  sale_unit?: string
  quantity?: number
}

type NotifyOrder = {
  id: number
  order_number: string
  customer_name: string
  customer_phone: string
  governorate: string
  address: string
  notes: string | null
  subtotal_piastres: number
  shipping_piastres: number
  total_piastres: number
  created_at: string
  order_items: NotifyItem[]
}

const ORDER_SELECT =
  'id,order_number,customer_name,customer_phone,governorate,address,notes,' +
  'subtotal_piastres,shipping_piastres,total_piastres,created_at,' +
  'order_items(product_name_ar,length_cm,width_cm,line_total_piastres,sale_unit,quantity)'

/** تهريب HTML لكل قيمة — parse_mode: 'HTML' (§7.3). */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function money(piastres: number): string {
  return (piastres / 100).toFixed(2) + ' جنيه'
}

function isNotifyOrder(value: unknown): value is NotifyOrder {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  if (typeof o['id'] !== 'number') return false
  if (typeof o['order_number'] !== 'string') return false
  if (typeof o['customer_name'] !== 'string') return false
  if (typeof o['customer_phone'] !== 'string') return false
  if (typeof o['governorate'] !== 'string') return false
  if (typeof o['address'] !== 'string') return false
  if (typeof o['created_at'] !== 'string') return false
  if (typeof o['subtotal_piastres'] !== 'number') return false
  if (typeof o['shipping_piastres'] !== 'number') return false
  if (typeof o['total_piastres'] !== 'number') return false
  return Array.isArray(o['order_items'])
}

function buildMessage(order: NotifyOrder): string {
  const when = new Date(order.created_at).toLocaleString('ar-EG', { timeZone: TIME_ZONE })

  const lines: string[] = [
    '🧾 <b>طلب جديد</b> — ' + escapeHtml(order.order_number),
    '',
    '<b>الاسم:</b> ' + escapeHtml(order.customer_name),
    '<b>الموبايل:</b> ' + escapeHtml(order.customer_phone),
    '<b>المحافظة:</b> ' + escapeHtml(order.governorate),
    '<b>العنوان:</b> ' + escapeHtml(order.address),
    '',
    '<b>الأصناف:</b>',
  ]

  for (const item of order.order_items) {
    lines.push(
      '• ' + escapeHtml(item.product_name_ar) +
        (item.sale_unit === 'piece'
          ? ' — الكمية ' + String(item.quantity ?? 1)
          : ' — ' + String(item.length_cm) + ' سم × ' + String(item.width_cm) + ' سم') +
        ' = ' + escapeHtml(money(item.line_total_piastres)),
    )
  }

  lines.push(
    '',
    '<b>الإجمالي الفرعي:</b> ' + escapeHtml(money(order.subtotal_piastres)),
    '<b>الشحن:</b> ' + escapeHtml(money(order.shipping_piastres)),
    '<b>الإجمالي:</b> ' + escapeHtml(money(order.total_piastres)),
  )

  // فني التركيب: سطر واضح أول الرسالة، والعلامة تتشال من الملاحظات
  const wantsInstaller = hasInstallerRequest(order.notes)
  const rawNotes = (order.notes ?? '').trim()
  const notes = wantsInstaller ? rawNotes.slice(INSTALLATION_NOTE_MARKER.length).trim() : rawNotes
  if (notes !== '') lines.push('', '<b>ملاحظات:</b> ' + escapeHtml(notes))

  lines.push('', '<b>الوقت:</b> ' + escapeHtml(when), '', '💵 الدفع عند الاستلام')
  if (wantsInstaller) lines.unshift('🔧 <b>الطلب ده محتاج فني تركيب</b> — كلّم العميل واتفق على المعاد والسعر', '')
  return lines.join('\n')
}

/**
 * بيرجّع null عند النجاح، أو كود قصير بدون PII عند الفشل.
 * ⚠️ التوكن جزء من الـURL، فممنوع الـURL أو نص الاستثناء يدخل أي لوج.
 */
export async function sendTelegram(text: string): Promise<string | null> {
  const token = (process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim()
  const chatId = (process.env['TELEGRAM_CHAT_ID'] ?? '').trim()
  if (token === '' || chatId === '') return 'TELEGRAM_NOT_CONFIGURED'

  let response: Response
  try {
    response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return 'TELEGRAM_TIMEOUT'
    return 'TELEGRAM_FETCH_FAILED'
  }

  if (!response.ok) return 'TELEGRAM_HTTP_' + String(response.status)
  return null
}

/**
 * notify_email: **مش سر** ويقدر يفضل في settings (§7.4). مفيش ناقل إيميل في
 * المرحلة الأولى، فالقيمة الفاضية حالة **معلنة** مش فشل صامت.
 */
async function emailChannelCode(): Promise<string | null> {
  const result = await restSelect<{ value: unknown }>('settings', 'key=eq.notify_email&select=value')
  if (!result.ok) return 'NOTIFY_EMAIL_UNREADABLE'

  const first = result.data[0]
  const value = typeof first?.value === 'string' ? first.value : ''
  return value.trim() === '' ? 'NOTIFY_EMAIL_NOT_SET' : null
}

/** علامة الحجز — قيمة مؤقتة في notify_error لحد ما النتيجة تتحدد. */
const CLAIM_MARKER = 'NOTIFY_IN_PROGRESS'

type ClaimOutcome = 'claimed' | 'taken' | 'unknown'

/**
 * حجز ذرّي **قبل** الإرسال.
 *
 * الـPATCH ده عبارة UPDATE واحدة بشرط جوه الاستعلام، فهي ذرّية: في تنفيذين
 * متزامنين واحد بس بياخد الصف، والتاني بيعيد تقييم الشرط بعد الـcommit
 * ويلاقي صفر صفوف.
 *
 * الشرط `notified_at is null & notify_error is null` بسيط عن قصد: بيستخدم
 * `is.null` بس، ومفيش اعتماد على عوامل PostgREST متقدمة.
 *
 * ⚠️ لو العملية ماتت بين الحجز والتسجيل، الصف بيفضل على CLAIM_MARKER —
 *    وده **الصح**: معناه «مش عارفين هل وصل»، وبيظهر في اللوحة كحالة تحتاج
 *    مراجعة بدل ما يتقال إنه نجح.
 *
 * ⚠️ لو الحجز رجع غموض (شكل رد غير متوقع)، بنكمل ونبعت. الاختيار مقصود:
 *    رسالة مكرّرة إزعاج، أما طلب الأدمن ما يعرفش بيه فده **بيع ضايع**.
 */
async function claimNotification(orderId: number): Promise<ClaimOutcome> {
  const claim = await restPatch(
    'orders',
    'id=eq.' + String(orderId) + '&notified_at=is.null&notify_error=is.null',
    { notify_error: CLAIM_MARKER, updated_at: new Date().toISOString() },
  )

  if (!claim.ok) return 'unknown'
  return claim.data.length > 0 ? 'claimed' : 'taken'
}

/**
 * المدخل الوحيد. بيتنادى من after() وبس، و**بس لما replayed === false**.
 *
 * منع الإرسال المكرر طبقتين **مختلفتين**:
 *   1. الراوت بينادي هنا مرة واحدة لكل طلب (الإدخال بينجح مرة واحدة).
 *   2. `claimNotification` حجز ذرّي **قبل** الإرسال — ده اللي بيمنع الإرسال
 *      المكرر فعلاً لو حصل نداء تاني لنفس الطلب.
 *
 * ⚠️ شرط `notified_at=is.null` في تحديث النجاح **مش** حارس إرسال — هو بيمنع
 *    **التسجيل** المكرر بس. الحارس ضد الإرسال هو الحجز فوق.
 */
export async function notifyNewOrder(orderNumber: string): Promise<void> {
  const startedAt = Date.now()

  try {
    const read = await restSelect<unknown>(
      'orders',
      'order_number=eq.' + encodeURIComponent(orderNumber) + '&select=' + encodeURIComponent(ORDER_SELECT),
    )
    if (!read.ok || read.data.length === 0 || !isNotifyOrder(read.data[0])) {
      console.error('[notify] ' + orderNumber + ' :: ORDER_UNREADABLE')
      return
    }
    const order = read.data[0]

    // الحجز **قبل** الإرسال — ده الحارس الحقيقي ضد الإرسال المكرر
    const claim = await claimNotification(order.id)
    if (claim === 'taken') {
      console.info('[notify] ' + orderNumber + ' :: SKIPPED_ALREADY_CLAIMED')
      return
    }
    if (claim === 'unknown') {
      // بنكمل ونبعت عن قصد — الطلب الضايع أسوأ من الرسالة المكرّرة
      console.error('[notify] ' + orderNumber + ' :: CLAIM_UNKNOWN_SENDING_ANYWAY')
    }

    const telegramCode = await sendTelegram(buildMessage(order))
    const elapsed = () => String(Date.now() - startedAt) + 'ms'

    if (telegramCode === null) {
      // بيشيل علامة الحجز ويسجّل النجاح. الشرط بيمنع **التسجيل** المكرر بس.
      const record = await restPatch('orders', 'id=eq.' + String(order.id) + '&notified_at=is.null', {
        notified_at: new Date().toISOString(),
        notify_error: null,
        updated_at: new Date().toISOString(),
      })

      if (!record.ok) {
        // ⚠️ الرسالة **وصلت** بس التسجيل فشل. ممنوع نقول SENT: الصف لسه على
        //    علامة الحجز، واللوحة هتبان كأن الإشعار معلّق. محتاج تدخل يدوي.
        console.error('[notify] ' + orderNumber + ' :: SENT_BUT_RECORD_FAILED :: ' + elapsed())
        return
      }
      if (record.data.length === 0) {
        // حد تاني سجّل النجاح قبلنا — مش خطأ
        console.info('[notify] ' + orderNumber + ' :: SENT_ALREADY_RECORDED :: ' + elapsed())
        return
      }

      console.info('[notify] ' + orderNumber + ' :: SENT :: ' + elapsed())
      return
    }

    // مفيش قناة اشتغلت — نسجّل كل الأكواد عشان الفشل ما يبقاش صامت
    const codes = [telegramCode]
    const emailCode = await emailChannelCode()
    if (emailCode !== null) codes.push(emailCode)

    const notifyError = codes.join(';').slice(0, MAX_NOTIFY_ERROR)

    // ⚠️ شرط `notified_at is null` **إلزامي** هنا كمان (ب١٨).
    //
    //    مع سياسة CLAIM_UNKNOWN_SENDING_ANYWAY ممكن يبقى في منفّذين: واحد
    //    بينجح ويسجّل notified_at، والتاني بيفشل بعديه. من غير الشرط ده التاني
    //    بيكتب notify_error فوق نجاح مسجّل، فالصف يبقى notified_at مظبوط **و**
    //    notify_error فيه فشل في نفس الوقت = **تحذير كاذب في اللوحة** على إشعار
    //    وصل فعلاً. الشرط بيخلّي الكتابة دي مستحيلة.
    const recordFailure = await restPatch(
      'orders',
      'id=eq.' + String(order.id) + '&notified_at=is.null',
      { notify_error: notifyError, updated_at: new Date().toISOString() },
    )

    if (!recordFailure.ok) {
      // فشل مزدوج: الإشعار ما وصلش **والسبب مش محفوظ**. الصف بيفضل على علامة
      // الحجز، فاللوحة لسه بتبان حالة تحتاج مراجعة — مش نجاح وهمي.
      console.error('[notify] ' + orderNumber + ' :: ' + notifyError + ' :: RECORD_FAILED :: ' + elapsed())
      return
    }

    if (recordFailure.data.length === 0) {
      // صفر صفوف = محاولة تانية سجّلت النجاح قبلنا. الإشعار **وصل**، فممنوع
      // نكتب فشل فوقه وممنوع نلوجه كأنه اتحفظ. الكود ده حالة صحية مش خطأ.
      console.info(
        '[notify] ' + orderNumber + ' :: FAILURE_ALREADY_RESOLVED :: ' + notifyError + ' :: ' + elapsed(),
      )
      return
    }

    console.error('[notify] ' + orderNumber + ' :: ' + notifyError + ' :: ' + elapsed())
  } catch (error) {
    // after() بيبلع الاستثناءات، فبنلوج الاسم بس ومنخلّيش الطلب يتأثر
    console.error('[notify] ' + orderNumber + ' :: THREW :: ' + (error instanceof Error ? error.name : 'unknown'))
  }
}