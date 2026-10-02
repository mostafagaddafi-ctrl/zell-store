'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { saveContentAction } from '../../lib/actions'
import type { StoreContent } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { SECTION_LABELS } from '../../lib/enums'
import { useMutationsEnabled } from '../../lib/readiness'
import { FailureBanner } from '../ui/FailureBanner'
import { Card, Field, inputClasses, textareaClasses } from '../ui/Field'
import { SaveBar } from '../ui/SaveBar'
import { Switch } from '../ui/Switch'
import { Button } from '../ui/Button'

function hrefState(href: string): { ok: boolean; note: string } {
  if (href.trim() === '') return { ok: true, note: 'يظهر كنص من غير رابط' }
  if (href.startsWith('/') || href.startsWith('https://')) return { ok: true, note: 'رابط شغّال' }
  return { ok: false, note: 'لازم يبدأ بـ / أو https://' }
}

export function ContentEditor({ content }: { content: StoreContent }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(content)

  const touch = (next: StoreContent) => {
    setDraft(next)
    markDirty()
  }

  /** «حاول تاني» لازم تبعت أحدث draft مش نسخة من وقت الضغط الأول. */
  const draftRef = useRef(draft)
  draftRef.current = draft

  // الطابع بييجي من السيرفر. بعد النجاح بيتغيّر فالمحتوى بيتزامن،
  // وبعد الفشل مابيتغيرش فالتعديلات بتفضل.
  const [syncedAt, setSyncedAt] = useState(content.updatedAt)
  useEffect(() => {
    if (content.updatedAt === syncedAt) return
    setSyncedAt(content.updatedAt)
    setDraft(content)
  }, [content, syncedAt])

  function save() {
    void run(() => saveContentAction(draftRef.current, draftRef.current.updatedAt), {
      onSuccess: () => router.refresh(),
    })
  }

  const sorted = [...draft.sections].sort((a, b) => a.sortOrder - b.sortOrder)

  /**
   * كارت «ترتيب وإظهار الأقسام» كان **ميّت بالكامل**: الأسهم من غير
   * onClick خالص، والمفتاح onChange فاضي مع disabled ثابت. يعني ترتيب
   * الأقسام وإظهارها مكانوش قابلين للتعديل من اللوحة أصلًا — مع إن
   * sortOrder و visible جزء من payload بتاع saveContentAction.
   */
  function moveSection(index: number, delta: number) {
    const list = [...sorted]
    const target = index + delta
    const from = list[index]
    const to = list[target]
    if (from === undefined || to === undefined) return
    list[index] = to
    list[target] = from
    // ترقيم صريح من ١ — نفس القيم الموجودة حاليًا في الإعدادات
    touch({ ...draft, sections: list.map((item, position) => ({ ...item, sortOrder: position + 1 })) })
  }

  function setSectionVisible(key: string, visible: boolean) {
    touch({
      ...draft,
      sections: draft.sections.map((item) => (item.key === key ? { ...item, visible } : item)),
    })
  }

  return (
    <div className="space-y-4">
      <Card title="الواجهة الرئيسية">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field htmlFor="hero-title" label="العنوان">
            <input
              id="hero-title"
              value={draft.hero.title}
              onChange={(e) => touch({ ...draft, hero: { ...draft.hero, title: e.target.value } })}
              className={inputClasses}
            />
          </Field>
          <Field htmlFor="hero-accent" label="الكلمة المميزة" hint="بتتلون بلون العلامة داخل العنوان">
            <input
              id="hero-accent"
              value={draft.hero.accent}
              onChange={(e) => touch({ ...draft, hero: { ...draft.hero, accent: e.target.value } })}
              className={inputClasses}
            />
          </Field>
          <Field htmlFor="hero-sub" label="الوصف" className="lg:col-span-2">
            <textarea
              id="hero-sub"
              value={draft.hero.subtitle}
              onChange={(e) => touch({ ...draft, hero: { ...draft.hero, subtitle: e.target.value } })}
              className={textareaClasses}
            />
          </Field>
          <Field htmlFor="hero-cta" label="نص الزرار">
            <input
              id="hero-cta"
              value={draft.hero.ctaLabel}
              onChange={(e) => touch({ ...draft, hero: { ...draft.hero, ctaLabel: e.target.value } })}
              className={inputClasses}
            />
          </Field>
        </div>

        <div className="mt-4 rounded border border-border bg-bg p-3">
          <p className="text-xs text-muted">معاينة:</p>
          <p className="mt-1 text-base font-extrabold text-fg">
            {draft.hero.title} <span className="text-brand">{draft.hero.accent}</span>
          </p>
        </div>
      </Card>

      <Card title="خطوات الطلب">
        <div className="space-y-3">
          {draft.orderSteps.map((step, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-2">
              <Field htmlFor={'step-t-' + String(index)} label={'خطوة ' + String(index + 1) + ' — العنوان'}>
                <input
                  id={'step-t-' + String(index)}
                  value={step.title}
                  onChange={(e) => {
                    const next = [...draft.orderSteps]
                    next[index] = { ...step, title: e.target.value }
                    touch({ ...draft, orderSteps: next })
                  }}
                  className={inputClasses}
                />
              </Field>
              <Field htmlFor={'step-d-' + String(index)} label="الوصف">
                <input
                  id={'step-d-' + String(index)}
                  value={step.description}
                  onChange={(e) => {
                    const next = [...draft.orderSteps]
                    next[index] = { ...step, description: e.target.value }
                    touch({ ...draft, orderSteps: next })
                  }}
                  className={inputClasses}
                />
              </Field>
            </div>
          ))}
          {draft.orderSteps.length === 0 ? <p className="text-xs text-muted">مفيش خطوات مسجّلة.</p> : null}
        </div>
      </Card>

      <Card title="الأسئلة الشائعة">
        <div className="space-y-4">
          {draft.faqs.map((faq, index) => (
            <div key={index} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
              <Field htmlFor={'faq-q-' + String(index)} label={'سؤال ' + String(index + 1)}>
                <input
                  id={'faq-q-' + String(index)}
                  value={faq.question}
                  onChange={(e) => {
                    const next = [...draft.faqs]
                    next[index] = { ...faq, question: e.target.value }
                    touch({ ...draft, faqs: next })
                  }}
                  className={inputClasses}
                />
              </Field>
              <Field htmlFor={'faq-a-' + String(index)} label="الإجابة">
                <textarea
                  id={'faq-a-' + String(index)}
                  value={faq.answer}
                  onChange={(e) => {
                    const next = [...draft.faqs]
                    next[index] = { ...faq, answer: e.target.value }
                    touch({ ...draft, faqs: next })
                  }}
                  className={textareaClasses}
                />
              </Field>
            </div>
          ))}
          {draft.faqs.length === 0 ? <p className="text-xs text-muted">مفيش أسئلة مسجّلة.</p> : null}
        </div>
        <p className="mt-3 text-xs text-muted">
          تجنّب كتابة أرقام زي عرض الرول أو أقل طول هنا — لو اتغيّرت من صفحة المنتج، الإجابة تبقى غلط.
        </p>
      </Card>

      <Card title="ترتيب وإظهار الأقسام">
        <ul className="divide-y divide-border">
          {sorted.map((section, index) => (
            <li key={section.key} className="flex items-center gap-3 py-2.5">
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={!mutationsOn || index === 0} onClick={() => moveSection(index, -1)} aria-label="تحريك لفوق" className="h-7 w-7 px-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!mutationsOn || index === sorted.length - 1}
                  onClick={() => moveSection(index, 1)}
                  aria-label="تحريك لتحت"
                  className="h-7 w-7 px-0"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{SECTION_LABELS[section.key]}</p>
                {section.title ? <p className="truncate text-xs text-muted">{section.title}</p> : null}
              </div>

              <Switch
                checked={section.visible}
                onChange={(next) => setSectionVisible(section.key, next)}
                disabled={!mutationsOn}
                label={'إظهار ' + SECTION_LABELS[section.key]}
              />
            </li>
          ))}
        </ul>
      </Card>

      {/*
        الشريط العلوي. مفيش زرار إغلاق للزائر في النسخة دي — التحكم من هنا
        بـ«مفعّل» بس. ونص فاضي بيقفل الشريط مهما كانت قيمة «مفعّل».
      */}
      <Card title="الشريط العلوي">
        <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">
          <input
            type="checkbox"
            checked={draft.announcement.enabled}
            onChange={(e) =>
              touch({ ...draft, announcement: { ...draft.announcement, enabled: e.target.checked } })
            }
          />
          مفعّل
        </label>

        <Field htmlFor="ann-text" label="النص" hint="فاضي = الشريط مقفول حتى لو مفعّل">
          <input
            id="ann-text"
            value={draft.announcement.text}
            onChange={(e) =>
              touch({ ...draft, announcement: { ...draft.announcement, text: e.target.value } })
            }
            className={inputClasses}
            placeholder="شحن مجاني للطلبات فوق ٥٠٠ جنيه"
          />
        </Field>

        <Field htmlFor="ann-href" label="الرابط (اختياري)" hint="يبدأ بشرطة واحدة للداخلي أو https">
          <input
            id="ann-href"
            value={draft.announcement.href}
            onChange={(e) =>
              touch({ ...draft, announcement: { ...draft.announcement, href: e.target.value } })
            }
            className={inputClasses}
            dir="ltr"
            placeholder="/product/1"
          />
        </Field>

        <Field htmlFor="ann-cta" label="نص الزرار (اختياري)" hint="بيظهر جنب النص لما يكون في رابط">
          <input
            id="ann-cta"
            value={draft.announcement.ctaLabel}
            onChange={(e) =>
              touch({ ...draft, announcement: { ...draft.announcement, ctaLabel: e.target.value } })
            }
            className={inputClasses}
            placeholder="اعرف أكتر"
          />
        </Field>
      </Card>

      <Card title="الفوتر">
        <div className="space-y-3">
          {draft.footerLinks.map((link, index) => {
            const status = hrefState(link.href)
            return (
              <div key={index} className="grid gap-2 sm:grid-cols-2">
                <Field htmlFor={'fl-l-' + String(index)} label={'رابط ' + String(index + 1) + ' — النص'}>
                  <input
                    id={'fl-l-' + String(index)}
                    value={link.label}
                    onChange={(e) => {
                      const next = [...draft.footerLinks]
                      next[index] = { ...link, label: e.target.value }
                      touch({ ...draft, footerLinks: next })
                    }}
                    className={inputClasses}
                  />
                </Field>
                <Field
                  htmlFor={'fl-h-' + String(index)}
                  label="المسار"
                  hint={status.ok ? status.note : undefined}
                  error={status.ok ? undefined : status.note}
                >
                  <input
                    id={'fl-h-' + String(index)}
                    value={link.href}
                    onChange={(e) => {
                      const next = [...draft.footerLinks]
                      next[index] = { ...link, href: e.target.value }
                      touch({ ...draft, footerLinks: next })
                    }}
                    className={inputClasses}
                    dir="ltr"
                    placeholder="/shipping-policy"
                  />
                </Field>
              </div>
            )
          })}
        </div>

        <Field htmlFor="trust" label="سطر الطمأنة" className="mt-4" hint="بيظهر تحت ملخص الطلب">
          <input id="trust" value={draft.trustLine} onChange={(e) => touch({ ...draft, trustLine: e.target.value })} className={inputClasses} />
        </Field>
      </Card>

      <a
        href="https://zell-store-nine.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        شوف المتجر
      </a>

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}
