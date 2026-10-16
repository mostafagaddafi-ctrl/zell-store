'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  POLICY_COMPANY_FIELDS,
  POLICY_COMPANY_LABELS,
  POLICY_KEYS,
  POLICY_LIMITS,
  POLICY_PAGE_LABELS,
  policyPath,
  type PolicyCompanyField,
  type PolicyKey,
  type PolicyPage,
  type PolicyPages,
} from '@zell/core'
import { savePolicyPagesAction } from '../../lib/actions'
import { useSaveAction } from '../../lib/client/useSaveAction'
import type { PolicyPagesRecord } from '../../lib/data/policyPages'
import { useMutationsEnabled } from '../../lib/readiness'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'

/** أمثلة عامة داخل الحقول الفارغة فقط — لا تُحفظ. */
const COMPANY_PLACEHOLDERS: Record<PolicyCompanyField, string> = {
  name: 'مثال: اسم الشركة كما في السجل التجاري',
  address: 'مثال: ١٢ شارع التحرير، الدقي، الجيزة',
  commercialRegister: 'مثال: ١٢٣٤٥٦',
  taxNumber: 'مثال: ١٢٣-٤٥٦-٧٨٩',
}

function lineCount(text: string): number {
  return text.replace(/\r\n?/g, '\n').trim().split('\n').length
}

/**
 * محرر «السياسات» (docs/contracts/POLICY-PAGES.md §٤) — حفظ واحد للأربع صفحات وبيانات البائع.
 *
 * ⚠️ مفيش ربط تلقائي بالفوتر: المالك بيحط رابط كل صفحة في «المحتوى» بنفسه.
 * ⚠️ الطابع (updated_at) بيتحدّث من رد الحفظ. «تجاهل وحدّث» بيعمل refresh، والصفحة بتركّب المحرر من جديد بـ key = الطابع.
 */
export function PolicyPagesEditor({ initial }: { initial: PolicyPagesRecord }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState<PolicyPages>(initial.pages)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const stampRef = useRef<string | null>(initial.updatedAt)
  const [copied, setCopied] = useState<PolicyKey | null>(null)

  const setPage = (key: PolicyKey, patch: Partial<PolicyPage>) => {
    setDraft((previous) => ({ ...previous, pages: { ...previous.pages, [key]: { ...previous.pages[key], ...patch } } }))
    markDirty()
  }

  const setCompany = (field: PolicyCompanyField, text: string) => {
    setDraft((previous) => ({ ...previous, company: { ...previous.company, [field]: text } }))
    markDirty()
  }

  function save() {
    const snapshot = draftRef.current
    const expected = stampRef.current
    void run(() => savePolicyPagesAction(snapshot, expected), {
      onSuccess: (saved) => {
        stampRef.current = saved.updatedAt
        setDraft(saved.pages)
      },
    })
  }

  function copyPath(key: PolicyKey) {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(policyPath(key)).then(
      () => setCopied(key),
      () => setCopied(null),
    )
  }

  const busy = state === 'saving'
  const locked = !mutationsOn || busy

  return (
    <div className="space-y-4">
      {POLICY_KEYS.map((key) => {
        const page = draft.pages[key]
        const titleId = 'policy-' + key + '-title'
        const bodyId = 'policy-' + key + '-body'
        const lines = lineCount(page.body)
        const emptyBody = page.body.trim() === ''
        return (
          <Card key={key} title={POLICY_PAGE_LABELS[key]}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">إظهار الصفحة في المتجر</p>
                  <p className="text-xs text-muted">
                    {page.enabled ? 'تظهر للعميل بعد الحفظ.' : 'مخفية — يظهر للعميل «الصفحة غير موجودة».'}
                  </p>
                </div>
                <Switch
                  checked={page.enabled}
                  onChange={(next) => setPage(key, { enabled: next })}
                  label={'إظهار صفحة ' + POLICY_PAGE_LABELS[key]}
                  disabled={locked}
                />
              </div>

              {key === 'privacy' ? (
                <p className="rounded border border-border bg-bg p-2 text-xs text-muted">
                  قبل تفعيل هذه الصفحة: تحقّق من إعدادات الإحصاءات في استضافة المتجر، واختر الصياغة المطابقة لها في النص.
                </p>
              ) : null}

              <Field
                htmlFor={titleId}
                label="عنوان الصفحة"
                hint={String(page.title.length) + '/' + String(POLICY_LIMITS.title)}
                error={page.title.trim() === '' ? 'العنوان مطلوب' : page.title.trim().length > POLICY_LIMITS.title ? 'أطول من المسموح' : undefined}
              >
                <input
                  id={titleId}
                  value={page.title}
                  onChange={(event) => setPage(key, { title: event.target.value })}
                  className={inputClasses}
                  disabled={locked}
                />
              </Field>

              <Field
                htmlFor={bodyId}
                label="نص الصفحة"
                hint={
                  'نص عادي: سطر فارغ يبدأ فقرة جديدة، والسطر الذي يبدأ بـ «- » يظهر كبند في قائمة · ' +
                  String(page.body.length) + '/' + String(POLICY_LIMITS.body) + ' حرف · ' +
                  String(lines) + '/' + String(POLICY_LIMITS.bodyLines) + ' سطر'
                }
                error={
                  page.body.length > POLICY_LIMITS.body || lines > POLICY_LIMITS.bodyLines
                    ? 'أطول من المسموح'
                    : page.enabled && emptyBody
                      ? 'لا يمكن إظهار الصفحة بنص فارغ'
                      : undefined
                }
              >
                <textarea
                  id={bodyId}
                  value={page.body}
                  rows={10}
                  onChange={(event) => setPage(key, { body: event.target.value })}
                  className={textareaClasses}
                  disabled={locked}
                />
              </Field>

              <div className="space-y-1 border-t border-border pt-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">رابط الصفحة:</span>
                  <code dir="ltr" className="rounded bg-bg px-1.5 py-0.5 text-fg">
                    {policyPath(key)}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyPath(key)}
                    className="rounded border border-border px-2 py-0.5 font-semibold text-fg transition-colors hover:border-accent"
                  >
                    {copied === key ? 'تم النسخ' : 'نسخ'}
                  </button>
                </div>
                <p className="text-xs text-muted">
                  أضف هذا الرابط في روابط أسفل الصفحة من «المحتوى». إذا أُضيف الرابط والصفحة غير مفعّلة، تظهر للعميل رسالة «الصفحة غير موجودة».
                </p>
              </div>
            </div>
          </Card>
        )
      })}

      <Card title="بيانات البائع">
        <div className="space-y-3">
          <p className="text-xs text-muted">
            اختيارية، وتظهر الحقول المملوءة فقط في آخر صفحة «الشروط والأحكام». يُنصح باستكمال بيانات البائع قبل الإطلاق.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {POLICY_COMPANY_FIELDS.map((field) => {
              const id = 'policy-company-' + field
              const value = draft.company[field]
              return (
                <Field
                  key={field}
                  htmlFor={id}
                  label={POLICY_COMPANY_LABELS[field]}
                  error={value.trim().length > POLICY_LIMITS.company ? 'أطول من المسموح' : undefined}
                >
                  <input
                    id={id}
                    value={value}
                    maxLength={POLICY_LIMITS.company + 50}
                    onChange={(event) => setCompany(field, event.target.value)}
                    placeholder={COMPANY_PLACEHOLDERS[field]}
                    className={inputClasses}
                    disabled={locked}
                  />
                </Field>
              )
            })}
          </div>
        </div>
      </Card>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />
      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
