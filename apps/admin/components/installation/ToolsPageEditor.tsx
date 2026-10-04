'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { INSTALLATION_TOOLS_PAGE_LIMITS, type InstallationToolsPage } from '@zell/core'
import { saveInstallationToolsPageAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import type { ToolsPageRecord, ToolsSummary } from '../../lib/mutations/installationToolsPage'
import { useMutationsEnabled } from '../../lib/readiness'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

type TextField = 'title' | 'description' | 'videoNote' | 'browseButtonLabel' | 'checkoutButtonLabel'

const TEXT_FIELDS: Array<{ key: TextField; label: string; hint: string; multiline: boolean }> = [
  { key: 'title', label: 'عنوان الصفحة', hint: 'فوق الصفحة وفي قائمة الموبايل', multiline: false },
  { key: 'description', label: 'وصف قصير (اختياري)', hint: 'تحت العنوان — فاضي = مايظهرش', multiline: true },
  {
    key: 'videoNote',
    label: 'ملاحظة الفيديو (اختياري)',
    hint: 'نص بس، زي «فيديو التركيب على صفحتنا». مفيش فيديو بيتبعت تلقائي — فاضي = مايظهرش',
    multiline: true,
  },
  { key: 'browseButtonLabel', label: 'نص زرار الأدوات', hint: 'في صفحة الفيلم بعد «ضيف للسلة» وفي السلة', multiline: false },
  { key: 'checkoutButtonLabel', label: 'نص زرار إتمام الطلب', hint: 'في صفحة الفيلم بعد الإضافة وفي صفحة الأدوات', multiline: false },
]

/**
 * محرر صفحة «أدوات التركيب» — المحتوى بس.
 *
 * ⚠️ الربط بين الفيلم وأدواته من صفحة الفيلم بس؛ هنا عرض للربط ولينك ليه.
 * ⚠️ الطابع (updated_at) بيتحدّث من رد الحفظ. «تجاهل وحدّث» بيعمل refresh،
 *    والصفحة بتركّب المحرر من جديد بـ key = الطابع، فبياخد نسخة السيرفر.
 */
export function ToolsPageEditor({ initial, summary }: { initial: ToolsPageRecord; summary: ToolsSummary }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<InstallationToolsPage>(initial.page)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const stampRef = useRef<string | null>(initial.updatedAt)

  const set = (patch: Partial<InstallationToolsPage>) => {
    setDraft((previous) => ({ ...previous, ...patch }))
    markDirty()
  }

  const setText = (key: TextField, text: string) => {
    setDraft((previous) => {
      const next = { ...previous }
      next[key] = text
      return next
    })
    markDirty()
  }

  function save() {
    const snapshot = draftRef.current
    const expected = stampRef.current
    void run(() => saveInstallationToolsPageAction(snapshot, expected), {
      onSuccess: (saved) => {
        stampRef.current = saved.updatedAt
        setDraft(saved.page)
      },
    })
  }

  const busy = state === 'saving'
  const activeTools = new Set<number>()
  let filmsWithTools = 0
  for (const film of summary.films) {
    const active = film.tools.filter((tool) => tool.isActive)
    if (active.length > 0) filmsWithTools += 1
    for (const tool of active) activeTools.add(tool.id)
  }
  const status = !draft.enabled
    ? 'مقفولة — مش ظاهرة للزبون.'
    : activeTools.size === 0
      ? 'مفعّلة، بس مفيش أداة نشطة مربوطة بفيلم نشط — مش هتظهر لحد ما تربط أدوات من صفحة الفيلم.'
      : 'ظاهرة للزبون بعد الحفظ — ' + String(activeTools.size) + ' أداة على ' + String(filmsWithTools) + ' فيلم.'

  return (
    <div className="space-y-4">
      <Card title="الصفحة">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">تشغيل صفحة «أدوات التركيب»</p>
              <p className="text-xs text-muted">
                مقفولة = الصفحة «مش موجودة» وأزرارها ولينك القائمة بيختفوا. كارت «محتاجها؟» في صفحة الفيلم شغال في الحالتين.
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onChange={(next) => set({ enabled: next })}
              label="تشغيل صفحة أدوات التركيب"
              disabled={!mutationsOn || busy}
            />
          </div>
          <p className={'border-t border-border pt-2 text-xs font-semibold ' + (draft.enabled && activeTools.size > 0 ? 'text-ok' : 'text-muted')}>
            {status}
          </p>

          {TEXT_FIELDS.map((field) => {
            const value = draft[field.key]
            const max = INSTALLATION_TOOLS_PAGE_LIMITS[field.key]
            const id = 'tools-page-' + field.key
            return (
              <Field
                key={field.key}
                htmlFor={id}
                label={field.label}
                hint={field.hint + ' · ' + String(value.length) + '/' + String(max)}
                error={value.length > max ? 'أطول من المسموح' : undefined}
              >
                {field.multiline ? (
                  <textarea
                    id={id}
                    value={value}
                    rows={2}
                    onChange={(event) => setText(field.key, event.target.value)}
                    className={textareaClasses}
                    disabled={!mutationsOn || busy}
                  />
                ) : (
                  <input
                    id={id}
                    value={value}
                    onChange={(event) => setText(field.key, event.target.value)}
                    className={inputClasses}
                    disabled={!mutationsOn || busy}
                  />
                )}
              </Field>
            )
          })}

          <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
          <SaveBar state={state} onSave={save} warning={warning} />
        </div>
      </Card>

      <Card title="الأفلام وأدواتها">
        <p className="mb-3 text-xs text-muted">
          للعرض بس. الربط من صفحة كل فيلم ← «التسعير والعروض» ← كارت «الإضافات». الباكدج منتج بالعدد عادي بسعره.
        </p>
        {summary.films.length === 0 ? (
          <p className="text-xs text-muted">مفيش أفلام بالمقاس نشطة.</p>
        ) : (
          <ul className="divide-y divide-border">
            {summary.films.map((film) => (
              <li key={film.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{film.name}</p>
                  <p className="text-xs text-muted">
                    {film.tools.length === 0
                      ? 'مفيش أدوات مربوطة'
                      : film.tools.map((tool) => tool.name + (tool.isActive ? '' : ' (متوقّفة)')).join(' · ')}
                  </p>
                </div>
                <Link href={'/products/' + String(film.id)} className="shrink-0 text-xs font-semibold text-accent">
                  عدّل الربط
                </Link>
              </li>
            ))}
          </ul>
        )}
        {summary.unlinkedPieces.length > 0 ? (
          <p className="mt-3 rounded border border-border bg-bg p-2 text-xs text-muted">
            {'منتجات بالعدد مش مربوطة بأي فيلم (مش هتظهر في صفحة الأدوات): ' +
              summary.unlinkedPieces.map((piece) => piece.name).join(' · ')}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
