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
  const [telegramToken, setTelegramToken] = useState('')

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

      <Card
        title="تليجرام"
        actions={settings.telegramConfigured ? <Badge tone="ok">متظبط</Badge> : <Badge tone="neutral">مش متظبط</Badge>}
      >
        {/*
          🔒 التوكن ما بيترجعش من السيرفر أبدًا. الخانة دي للإدخال بس،
          وبتتبعت في اتجاه واحد. القراءة بترجّع حالة boolean لا أكتر.
        */}
        <Field
          htmlFor="tg"
          label="توكن البوت"
          hint="إدخال فقط — التوكن المحفوظ ما بيتعرضش نهائيًا. سيبها فاضية عشان ما تغيّرش."
        >
          <input
            id="tg"
            type="password"
            autoComplete="off"
            value={telegramToken}
            onChange={(e) => {
              setTelegramToken(e.target.value)
              setState('dirty')
            }}
            className={inputClasses}
            dir="ltr"
            placeholder="••••••••"
          />
        </Field>
        <p className="mt-2 text-xs text-muted">
          الأفضل لاحقًا نقل التوكن لمتغيرات البيئة بدل قاعدة البيانات.
        </p>
      </Card>

      <Card title="مؤشر الجاهزية">
        <ul className="space-y-2.5">
          {settings.readiness.map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.ok ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
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
