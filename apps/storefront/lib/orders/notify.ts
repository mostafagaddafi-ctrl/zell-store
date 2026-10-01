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

import { restPatch, restSelect } from '../data/rpc'

const TELEGRAM_TIMEOUT_MS = 5000
const MAX_NOTIFY_ERROR = 200
const TIME_ZONE = 'Africa/Cairo'

type NotifyItem = {
  product_name_ar: string
  length_cm: number
  width_cm: number
  line_total_piastres: number
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
  'order_items(product_name_ar,length_cm,width_cm,line_total_piastres)'

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
        ' — ' + String(item.length_cm) + ' سم × ' + String(item.width_cm) + ' سم' +
        ' = ' + escapeHtml(money(item.line_total_piastres)),
    )
  }

  lines.push(
    '',
    '<b>الإجمالي الفرعي:</b> ' + escapeHtml(money(order.subtotal_piastres)),
    '<b>الشحن:</b> ' + escapeHtml(money(order.shipping_piastres)),
    '<b>الإجمالي:</b> ' + escapeHtml(money(order.total_piastres)),
  )

  const notes = (order.notes ?? '').trim()
  if (notes !== '') lines.push('', '<b>ملاحظات:</b> ' + escapeHtml(notes))

  lines.push('', '<b>الوقت:</b> ' + escapeHtml(when), '', '💵 الدفع عند الاستلام')
  return lines.join('\n')
}

/**
 * بيرجّع null عند النجاح، أو كود قصير بدون PII عند الفشل.
 * ⚠️ التوكن جزء من الـURL، فممنوع الـURL أو نص الاستثناء يدخل أي لوج.
 */
async function sendTelegram(text: string): Promise<string | null> {
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

/**
 * المدخل الوحيد. بيتنادى من after() وبس، و**بس لما replayed === false**
 * (الحارس الأول من ب٦). الحارس التاني `notified_at is null` في تحديث النجاح.
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

    const telegramCode = await sendTelegram(buildMessage(order))

    if (telegramCode === null) {
      // الحارس التاني ضد الإشعار المكرر: الشرط جزء من الاستعلام نفسه
      await restPatch('orders', 'id=eq.' + String(order.id) + '&notified_at=is.null', {
        notified_at: new Date().toISOString(),
        notify_error: null,
        updated_at: new Date().toISOString(),
      })
      console.info('[notify] ' + orderNumber + ' :: SENT :: ' + String(Date.now() - startedAt) + 'ms')
      return
    }

    // مفيش قناة اشتغلت — نسجّل كل الأكواد عشان الفشل ما يبقاش صامت
    const codes = [telegramCode]
    const emailCode = await emailChannelCode()
    if (emailCode !== null) codes.push(emailCode)

    const notifyError = codes.join(';').slice(0, MAX_NOTIFY_ERROR)
    await restPatch('orders', 'id=eq.' + String(order.id), {
      notify_error: notifyError,
      updated_at: new Date().toISOString(),
    })
    console.error('[notify] ' + orderNumber + ' :: ' + notifyError + ' :: ' + String(Date.now() - startedAt) + 'ms')
  } catch (error) {
    // after() بيبلع الاستثناءات، فبنلوج الاسم بس ومنخلّيش الطلب يتأثر
    console.error('[notify] ' + orderNumber + ' :: THREW :: ' + (error instanceof Error ? error.name : 'unknown'))
  }
}