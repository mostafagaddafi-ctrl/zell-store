'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SOCIAL_LABELS, SOCIAL_PLATFORMS, type SocialPlatform } from '@zell/core'
import { saveSocialLinksAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import type { SocialLinksInput } from '../../lib/data/socialLinks'
import { useMutationsEnabled } from '../../lib/readiness'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'

/** أمثلة عامة داخل الحقول الفارغة فقط — لا تُحفظ ولا تظهر في المتجر. */
const PLACEHOLDERS: Record<SocialPlatform, string> = {
  facebook: 'facebook.com/اسم-الصفحة',
  instagram: 'instagram.com/اسم-الحساب',
  tiktok: 'tiktok.com/@اسم-الحساب',
  youtube: 'youtube.com/@اسم-القناة',
  snapchat: 'snapchat.com/add/اسم-الحساب',
  x: 'x.com/اسم-الحساب',
}

/**
 * روابط السوشيال — بتظهر أيقونات في فوتر المتجر. الخانة الفاضية = الأيقونة مخفية.
 */
export function SocialLinksEditor({ initial }: { initial: SocialLinksInput }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<SocialLinksInput>(initial)

  const set = (platform: SocialPlatform, url: string) => {
    setDraft((current) => ({ ...current, [platform]: url }))
    markDirty()
  }

  function save() {
    void run(() => saveSocialLinksAction(draft), {
      onSuccess: (data) => {
        setDraft(data)
        router.refresh()
      },
    })
  }

  return (
    <Card title="السوشيال ميديا">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          يُلصق رابط الحساب، ويظهر كأيقونة تحت «تابعنا» في أسفل كل صفحة في المتجر. ولا تظهر الحقول الفارغة.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <Field key={platform} htmlFor={'social-' + platform} label={SOCIAL_LABELS[platform]}>
              <input
                id={'social-' + platform}
                type="text"
                inputMode="url"
                dir="ltr"
                autoComplete="off"
                value={draft[platform]}
                maxLength={300}
                onChange={(event) => set(platform, event.target.value)}
                placeholder={PLACEHOLDERS[platform]}
                className={inputClasses + ' text-left'}
                disabled={!mutationsOn}
              />
            </Field>
          ))}
        </div>

        <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
        <SaveBar state={state} onSave={save} warning={warning} />
      </div>
    </Card>
  )
}
