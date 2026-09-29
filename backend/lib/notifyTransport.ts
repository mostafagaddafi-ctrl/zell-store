/**
 * ناقل الإشعار — الجزء الوحيد المرتبط بالمنصّة.
 *
 * داخل Retool: الشبكة الخارجية (fetch) مقفولة في منفّذ الدوال، فالإشعار بيتبعت
 * على الإيميل عن طريق مورد Retool Email.
 * بعد النقل لـ Vercel: استبدل جسم الدالة باستدعاء تليجرام (موجود جاهز في HANDOFF.md)
 * — نص الرسالة نفسه (notifyMessage.ts) مش بيتغيّر.
 *
 * قاعدة ثابتة: الإشعار ما يوقّعش الطلب أبداً — كل حاجة جوه try/catch وبـ timeout.
 */
import {
  buildOrderNotificationHtml,
  buildOrderNotificationSubject,
  buildOrderNotificationText,
  type OrderNotificationInput,
} from './notifyMessage'

export type NotifyResult = { ok: boolean; skipped?: boolean; error?: string }

const TIMEOUT_MS = 10000

export type NotifyConfig = {
  notify_email?: string
  store_name?: string
}

export async function sendOrderNotification(
  order: OrderNotificationInput,
  config: NotifyConfig,
): Promise<NotifyResult> {
  const to = (config.notify_email ?? '').trim()
  const storeName = (config.store_name ?? 'المتجر').trim()
  if (!to) return { ok: false, skipped: true, error: 'لم يتم ضبط إيميل الإشعارات في الإعدادات' }

  try {
    await withTimeout(
      retoolEmail.sendEmail({
        to,
        subject: buildOrderNotificationSubject(order, storeName),
        body: buildOrderNotificationHtml(order, storeName),
        bodyType: 'html',
      }),
      TIMEOUT_MS,
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String((err as { message?: string })?.message ?? err) }
  }
}

/** نص الإشعار الجاهز — مفيد للمعاينة في اللوحة وللنقل لتليجرام. */
export function previewOrderNotification(order: OrderNotificationInput, storeName: string): string {
  return buildOrderNotificationText(order, storeName)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`انتهت مهلة الإشعار بعد ${ms} مللي ثانية`)), ms)
    }),
  ])
}
