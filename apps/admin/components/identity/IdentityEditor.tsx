'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveIdentityAction, setOfferEnabledAction } from '../../lib/actions'
import type { StoreIdentity } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'
import { useMutationsEnabled } from '../../lib/readiness'
import { SiteImageCard } from './SiteImageCard'

export function IdentityEditor({ identity }: { identity: StoreIdentity }) {
  const router = useRouter()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(identity)

  const touch = (patch: Partial<StoreIdentity>) => {
    setDraft({ ...draft, ...patch })
    markDirty()
  }

  /** «إعادة المحاولة» لازم تبعت أحدث draft مش نسخة من وقت الضغط الأول. */
  const draftRef = useRef(draft)
  draftRef.current = draft

  // الصور **مش** داخلة في الحفظ ولا في الطابع — zell_save_identity
  // بتقفل أربعة مفاتيح بس ومابتلمسش site_images.
  const [syncedAt, setSyncedAt] = useState(identity.updatedAt)
  useEffect(() => {
    if (identity.updatedAt === syncedAt) return
    setSyncedAt(identity.updatedAt)
    setDraft(identity)
  }, [identity, syncedAt])

  function save() {
    void run(() => saveIdentityAction(draftRef.current, draftRef.current.updatedAt), {
      onSuccess: () => router.refresh(),
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SiteImageCard
          kind="logo"
          title="اللوجو"
          image={identity.logo}
          accept="image/png,image/webp"
          emptyLabel="خانة اللوجو"
          previewClassName="h-24 w-24"
          requirements="PNG أو WebP بخلفية شفافة. يُفضَّل أن يكون أفقيًا (مثل 600×160) دون هوامش داخلية حول الشعار، لأن الهوامش تجعله يبدو صغيرًا. يظهر في رأس المتجر بارتفاع 40 بكسل."
        />

        <Card title="المتجر">
          <div className="space-y-3">
            <Field htmlFor="store-name" label="اسم المتجر">
              <input id="store-name" value={draft.storeName} onChange={(e) => touch({ storeName: e.target.value })} className={inputClasses} />
            </Field>
            <Field
              htmlFor="offer"
              label="نص العرض"
              hint="بيظهر كهدية في صفحة المنتج جنب زرار «ضيف للسلة»، وفي ملخص الطلب في السلة وبيانات التوصيل."
            >
              <input id="offer" value={draft.offerText} onChange={(e) => touch({ offerText: e.target.value })} className={inputClasses} />
            </Field>
            <OfferToggle enabled={identity.offerEnabled !== false} />
          </div>
        </Card>
      </div>

      <SiteImageCard
        kind="hero"
        title="صورة الواجهة"
        image={identity.heroImage}
        accept="image/jpeg,image/png,image/webp"
        emptyLabel="خانة صورة الواجهة"
        previewClassName="h-24 w-32"
        requirements="JPEG أو PNG أو WebP، بحد أدنى 800×450، ويُفضَّل أن تكون أفقية بنسبة 4:3. تظهر بجوار نص الواجهة في الصفحة الرئيسية، وبدونها تُعرض الواجهة نصًا فقط."
      />

      <Card title="واتساب">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="wa-number" label="الرقم" hint="بصيغة دولية من غير +">
            <input id="wa-number" value={draft.whatsappNumber} onChange={(e) => touch({ whatsappNumber: e.target.value })} className={inputClasses} dir="ltr" />
          </Field>
          <Field htmlFor="wa-msg" label="الرسالة الجاهزة">
            <input id="wa-msg" value={draft.whatsappMessage} onChange={(e) => touch({ whatsappMessage: e.target.value })} className={inputClasses} />
          </Field>
        </div>
      </Card>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}

/**
 * مفتاح «إظهار نص العرض» — بيتحفظ فورًا، مستقل عن زرار حفظ الهوية.
 * القفل بيخفي شريط الهدية بس — النص نفسه بيفضل محفوظ زي ما هو.
 */
function OfferToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry } = useSaveAction()
  const busy = state === 'saving'

  return (
    <div className="mt-3 space-y-2 rounded border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">إظهار نص العرض في المتجر</p>
          <p className="text-xs text-muted">
            بيتحفظ فورًا. مقفول = الهدية ماتظهرش في صفحة المنتج ولا في ملخص الطلب. النص بيفضل محفوظ.
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => {
            void run(() => setOfferEnabledAction(next), { onSuccess: () => router.refresh() })
          }}
          label="إظهار نص العرض في المتجر"
          disabled={!mutationsOn || busy}
        />
      </div>
      {state === 'saved' ? <p className="text-xs font-semibold text-ok">اتحفظ</p> : null}
      {warning ? <p className="text-xs font-semibold text-gold">{warning}</p> : null}
      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
    </div>
  )
}
