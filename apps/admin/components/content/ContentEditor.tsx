'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { StoreContent } from '../../lib/adminData'
import { SECTION_LABELS, type SaveState } from '../../lib/enums'
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
  const [state, setState] = useState<SaveState>('idle')
  const [draft, setDraft] = useState(content)

  const touch = (next: StoreContent) => {
    setDraft(next)
    setState('dirty')
  }

  const sorted = [...draft.sections].sort((a, b) => a.sortOrder - b.sortOrder)

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
                <Button variant="ghost" size="sm" disabled={index === 0} aria-label="تحريك لفوق" className="h-7 w-7 px-0">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === sorted.length - 1}
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
                onChange={() => undefined}
                disabled
                label={'إظهار ' + SECTION_LABELS[section.key]}
              />
            </li>
          ))}
        </ul>
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

      <SaveBar state={state} />
    </div>
  )
}
