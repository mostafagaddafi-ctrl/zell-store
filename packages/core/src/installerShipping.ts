/**
 * INSTALLER-SHIPPING (العقد docs/contracts/INSTALLER-SHIPPING.md §٣) — الانتقال بدل الشحن لما العميل يطلب فني.
 *   • الحساب = zell_create_order بعد 0025: طلب بفني اتقبل = الشحن 0، واختيار الشحن (عادي/سريع) بيتجاهل. من غير فني = زي ما هو.
 *   • العرض من لقطة الطلب المحفوظة بس: فني + شحن محفوظ 0 = من غير سطر شحن، والانتقال باسم «توصيل وانتقال الفني» بقيمته.
 *     فني + شحن محفوظ أكبر من 0 (طلبات قبل تطبيق 0025، زي FLM-CRS5EA) = العرض القديم بالظبط. من غير فني = زي ما هو.
 * من غير أي import: سكربت المقارنة في CI (backend/db/ci/0025_core_parity.mjs) بيشغّل الملف ده بـ node مباشرة.
 */

/** اسم السطر الواحد مع الفني (قرار المالك ق٣) — من غير كلمة «مجاني». */
export const INSTALLER_DELIVERY_LABEL = 'توصيل وانتقال الفني'

/**
 * الشحن اللي الطلب بيتحاسب عليه: الفني جاهز (اتقبل بمنطقته) = 0، وإلا شحن الطريقة زي ما هو.
 * null = المحافظة لسه مش متحددة (ومع الفني الجاهز المحافظة متحددة دايمًا).
 */
export function chargedShippingPiastres(installationReady: boolean, methodShippingPiastres: number | null): number | null {
  return installationReady ? 0 : methodShippingPiastres
}

/** عرض طلب محفوظ: true = من غير سطر شحن، والانتقال باسم INSTALLER_DELIVERY_LABEL. القرار من المبلغ المحفوظ نفسه. */
export function installerDeliveryShown(installationRequested: boolean, shippingPiastres: number): boolean {
  return installationRequested === true && shippingPiastres === 0
}
