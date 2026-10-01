'use client'

import { useState } from 'react'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import type { OperationalSettings, SaveState } from '../../lib/adminData'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses } from '../ui/Field'
import { NotImplementedNotice } from '../ui/NotImplementedNotice'
import { SaveBar } from '../ui/SaveBar'

export function SettingsEditor({ settings }: { settings: OperationalSettings }) {
  const [state, setState] = useState<SaveState>('idle')
  const [notifyEmail, setNotifyEmail] = useState(settings.notifyEmail)

  return (
    <div className="space-y-4">
      {/*
        إشعار مستقل عن العلم عن قصد: saveOperationalSettingsAction و
        revalidateStorefrontAction **الاتنين ما اتعملوش**. لو الصفحة
        اعتمدت على PreviewNotice بس، كانت هتبان شغّالة بعد فتح العلم.
      */}
      <NotImplementedNotice
        what="حفظ إعدادات الإشعارات وتحديث كاش المتجر لسه ما اتعملوش — الصفحة دي للقراءة بس."
        note="مؤشر الجاهزية تحت بيقرا من قاعدة البيانات فعلًا."
      />

      <Card title="إشعارات الطلبات">
        <Field
          htmlFor="notify"
          label="بريد الإشعارات"
          hint="بيوصله إشعار بكل طلب جديد"
          error={notifyEmail.trim() === '' ? 'مفيش بريد متظبط — مش هتوصلك إشعارات' : undefined}
        >
          <input
            id="notify"
            type="email"
            value={notifyEmail}
            onChange={(e) => {
              setNotifyEmail(e.target.value)
              setState('dirty')
            }}
            className={inputClasses}
            dir="ltr"
            placeholder="orders@example.com"
          />
        </Field>
      </Card>

      {/*
        🔒 خانة توكن البوت **اتشالت** (ب١٩). الأسرار بقت في متغيرات بيئة المتجر
        على Vercel، وخانة إدخال في اللوحة كانت بتدعو حد يلزق سر في فورم مربوط
        بقاعدة البيانات. اللوحة بقت **ما بتقراش ولا بتكتب** أي سر.
      */}
      <Card
        title="تسليم الإشعارات"
        actions={
          settings.notifyDelivery.state === 'ok' ? (
            <Badge tone="ok">سليم</Badge>
          ) : settings.notifyDelivery.state === 'warn' ? (
            <Badge tone="danger">فيه فشل</Badge>
          ) : (
            <Badge tone="neutral">ما اتأكدش</Badge>
          )
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          أسرار تليجرام بقت في متغيرات بيئة المتجر على Vercel، مش في قاعدة البيانات.
          واللوحة <b className="font-semibold text-fg">مشروع Vercel منفصل</b> فمستحيل
          تقرا متغيرات المتجر — وعشان كده المؤشر ده بيقيس
          <b className="font-semibold text-fg"> التسليم الفعلي </b>
          من بيانات الطلبات، مش الإعداد.
        </p>

        {settings.notifyDelivery.countsExact ? (
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>النافذة: آخر {String(settings.notifyDelivery.windowHours)} ساعة</li>
            <li>طلبات في النافذة: {String(settings.notifyDelivery.recentOrders)}</li>
            <li>فيهم فشل أو إشعار معلّق: {String(settings.notifyDelivery.failedOrders)}</li>
          </ul>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            العدّ الدقيق مش متاح دلوقتي، فالأرقام مش معروضة عن قصد. المؤشر فوق
            <b className="font-semibold text-fg"> مش «سليم» </b>
            لحد ما العدّ يرجع.
          </p>
        )}

        {settings.notifyDelivery.state === 'unknown' ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            مفيش طلبات في النافذة، فمفيش دليل على إن الإشعار شغّال. الحالة دي
            <b className="font-semibold text-fg"> مش «سليم» </b>
            عن قصد.
          </p>
        ) : null}
      </Card>

      <Card title="مؤشر الجاهزية">
        <ul className="space-y-2.5">
          {settings.readiness.map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.state === 'ok' ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
              ) : (
                <AlertTriangle
                  className={
                    'mt-0.5 h-4 w-4 shrink-0 ' + (check.state === 'unknown' ? 'text-muted' : 'text-danger')
                  }
                />
              )}
              <div>
                <p className="text-xs font-semibold text-fg">{check.label}</p>
                <p className="text-xs text-muted">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="كاش المتجر">
        <p className="text-xs leading-relaxed text-muted">
          المتجر بيحدّث بياناته كل ٥ دقايق. الزرار ده بيخليه يجيب النسخة الجديدة فورًا بعد أي تعديل.
        </p>
        <Button variant="secondary" size="sm" className="mt-3" disabled>
          <RefreshCw className="h-3.5 w-3.5" />
          حدّث المتجر دلوقتي
        </Button>
      </Card>

      <SaveBar state={state} />
    </div>
  )
}
