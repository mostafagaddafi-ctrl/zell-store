'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import type { SaveState, StoreIdentity } from '../../lib/adminData'
import { Button } from '../ui/Button'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'

export function IdentityEditor({ identity }: { identity: StoreIdentity }) {
  const [state, setState] = useState<SaveState>('idle')
  const [draft, setDraft] = useState(identity)

  const touch = (patch: Partial<StoreIdentity>) => {
    setDraft({ ...draft, ...patch })
    setState('dirty')
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="اللوجو">
          <div className="flex items-center gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded border border-border bg-bg text-center text-xs text-muted">
              {draft.logo?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.logo.url} alt={draft.logo.alt} className="h-full w-full object-contain p-2" />
              ) : (
                'خانة اللوجو'
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted">
                مربع، 1024×1024، خلفية شفافة. بيظهر في هيدر المتجر.
              </p>
              <Button variant="secondary" size="sm" disabled>
                <Upload className="h-3.5 w-3.5" />
                استبدال اللوجو
              </Button>
            </div>
          </div>
        </Card>

        <Card title="المتجر">
          <div className="space-y-3">
            <Field htmlFor="store-name" label="اسم المتجر">
              <input id="store-name" value={draft.storeName} onChange={(e) => touch({ storeName: e.target.value })} className={inputClasses} />
            </Field>
            <Field htmlFor="offer" label="نص العرض" hint="شريط صغير فوق عنوان الصفحة الرئيسية">
              <input id="offer" value={draft.offerText} onChange={(e) => touch({ offerText: e.target.value })} className={inputClasses} />
            </Field>
          </div>
        </Card>
      </div>

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

      <SaveBar state={state} />
    </div>
  )
}
