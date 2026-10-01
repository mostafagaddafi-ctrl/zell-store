'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveIdentityAction } from '../../lib/actions'
import type { StoreIdentity } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { SiteImageCard } from './SiteImageCard'

export function IdentityEditor({ identity }: { identity: StoreIdentity }) {
  const router = useRouter()
  const { state, failure, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(identity)

  const touch = (patch: Partial<StoreIdentity>) => {
    setDraft({ ...draft, ...patch })
    markDirty()
  }

  /** «حاول تاني» لازم تبعت أحدث draft مش نسخة من وقت الضغط الأول. */
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
          requirements="PNG أو WebP بخلفية شفافة. يفضّل أفقي (مثلاً 600×160) من غير هوامش داخلية حوالين الشعار — الهوامش بتخلّيه يبان صغير في الهيدر. بيظهر في هيدر المتجر بارتفاع 40 بكسل."
        />

        <Card title="المتجر">
          <div className="space-y-3">
            <Field htmlFor="store-name" label="اسم المتجر">
              <input id="store-name" value={draft.storeName} onChange={(e) => touch({ storeName: e.target.value })} className={inputClasses} />
            </Field>
            <Field
              htmlFor="offer"
              label="شارة الواجهة الرئيسية"
              hint="سطر صغير يظهر جوه الواجهة (Hero) فوق العنوان مباشرة. ده مش الشريط العلوي — الشريط بيتظبط من صفحة المحتوى تحت «الشريط العلوي»."
            >
              <input id="offer" value={draft.offerText} onChange={(e) => touch({ offerText: e.target.value })} className={inputClasses} />
            </Field>
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
        requirements="JPEG أو PNG أو WebP. أقل مقاس 800×450، ويفضّل نسبة 4:3 أفقية. بتظهر جنب نص الواجهة في الصفحة الرئيسية. من غيرها بتفضل الخانة البديلة ظاهرة."
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

      <SaveBar state={state} onSave={save} />
    </div>
  )
}
