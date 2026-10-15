'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { saveContentAction } from '../../lib/actions'
import type { StoreContent } from '../../lib/adminData'
import { useSaveAction } from '../../lib/client/useSaveAction'
import { HOME_MOBILE_NOTE, HOME_MOBILE_OPTIONS, HOME_MOBILE_TITLE, type HomeMobileLayout } from '../../lib/content/homeMobile'
import { SIZE_ENTRY_NOTE, SIZE_ENTRY_OPTIONS, SIZE_ENTRY_TITLE } from '../../lib/content/sizeEntry'
import { SECTION_LABELS } from '../../lib/enums'
import { STOREFRONT_LINK_NOT_SET } from '../../lib/storefront/link'
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

/** storefrontHref: رابط «شوف المتجر» — من السيرفر (lib/storefrontLink.ts). null = الإعداد مش مضبوط: اللينك بيستخبى والتنبيه بيظهر. */
export function ContentEditor({ content, storefrontHref }: { content: StoreContent; storefrontHref: string | null }) {
  const router = useRouter()
  const mutationsOn = useMutationsEnabled()
  const { state, failure, warning, run, retry, markDirty } = useSaveAction()
  const [draft, setDraft] = useState(content)

  const touch = (next: StoreContent) => {
    setDraft(next)
    markDirty()
  }

  /** «إعادة المحاولة» لازم تبعت أحدث draft مش نسخة من وقت الضغط الأول. */
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

  // HOME-MOBILE — «تخطيط أعلى الصفحة الرئيسية على الهاتف» على عنصر hero، وبيتحفظ مع المحتوى (نفس action)
  const heroMobile: HomeMobileLayout = draft.sections.find((item) => item.key === 'hero')?.mobileLayout ?? 'compact'
  function setHeroMobileLayout(value: HomeMobileLayout) {
    touch({
      ...draft,
      sections: draft.sections.map((item) => (item.key === 'hero' ? { ...item, mobileLayout: value } : item)),
    })
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

        <fieldset className="mt-4 space-y-2 rounded border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-fg">{HOME_MOBILE_TITLE}</legend>
          {HOME_MOBILE_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="radio"
                name="hero-mobile-layout"
                value={option.value}
                checked={heroMobile === option.value}
                onChange={() => setHeroMobileLayout(option.value)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted">{HOME_MOBILE_NOTE}</p>
        </fieldset>
      </Card>

      {/* LENGTH-INPUT — الطريقة الأولى لإدخال المقاس في صفحة المنتج (settings.hero.productSizeEntry)، وبيتحفظ مع المحتوى (نفس action) */}
      <Card title={SIZE_ENTRY_TITLE}>
        <fieldset className="space-y-2">
          <legend className="sr-only">{SIZE_ENTRY_TITLE}</legend>
          {SIZE_ENTRY_OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="radio"
                name="product-size-entry"
                value={option.value}
                checked={draft.hero.productSizeEntry === option.value}
                onChange={() => touch({ ...draft, hero: { ...draft.hero, productSizeEntry: option.value } })}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted">{SIZE_ENTRY_NOTE}</p>
        </fieldset>
      </Card>

      <Card title="خطوات الطلب">
        <div className="space-y-3">
          {draft.orderSteps.map((step, index) => (
            <div key={index} className="space-y-2 rounded border border-border p-3">
              <ItemControls
                label={'خطوة ' + String(index + 1)}
                index={index}
                count={draft.orderSteps.length}
                disabled={!mutationsOn}
                onMove={(delta) => touch({ ...draft, orderSteps: moveItem(draft.orderSteps, index, delta) })}
                onRemove={() => touch({ ...draft, orderSteps: draft.orderSteps.filter((_, position) => position !== index) })}
              />
              <div className="grid gap-2 sm:grid-cols-2">
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
            </div>
          ))}
          {draft.orderSteps.length === 0 ? <p className="text-xs text-muted">مفيش خطوات مسجّلة.</p> : null}
          <AddItemButton
            label="ضيف خطوة"
            count={draft.orderSteps.length}
            max={8}
            disabled={!mutationsOn}
            onClick={() => touch({ ...draft, orderSteps: [...draft.orderSteps, { title: '', description: '' }] })}
          />
        </div>
      </Card>

      <Card title="الأسئلة الشائعة">
        <div className="space-y-4">
          {draft.faqs.map((faq, index) => (
            <div key={index} className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0">
              <ItemControls
                label={'سؤال ' + String(index + 1)}
                index={index}
                count={draft.faqs.length}
                disabled={!mutationsOn}
                onMove={(delta) => touch({ ...draft, faqs: moveItem(draft.faqs, index, delta) })}
                onRemove={() => touch({ ...draft, faqs: draft.faqs.filter((_, position) => position !== index) })}
              />
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
          <AddItemButton
            label="ضيف سؤال"
            count={draft.faqs.length}
            max={30}
            disabled={!mutationsOn}
            onClick={() => touch({ ...draft, faqs: [...draft.faqs, { question: '', answer: '' }] })}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          يُفضَّل عدم كتابة أرقام مثل عرض الرول أو أقل طول هنا، لأنها قد تتغيّر من صفحة المنتج فتصبح الإجابة غير صحيحة.
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
        الشريط العلوي — رفيع وثابت، من غير حركة ولا زرار إغلاق. للإعلانات
        المهمة بس. «نص العرض» مكانه صفحة المنتج وملخص الطلب كهدية.
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

        <Field htmlFor="ann-text" label="النص" hint="شريط رفيع فوق الهيدر للإعلانات المهمة (خصم · مواعيد). فاضي = الشريط مقفول حتى لو مفعّل">
          <input
            id="ann-text"
            value={draft.announcement.text}
            onChange={(e) =>
              touch({ ...draft, announcement: { ...draft.announcement, text: e.target.value } })
            }
            className={inputClasses}
            placeholder="اكتب نص الشريط"
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
            placeholder="/... أو https://..."
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
            placeholder="نص الزرار"
          />
        </Field>
      </Card>

      <Card title="الفوتر">
        <div className="space-y-3">
          {draft.footerLinks.map((link, index) => {
            const status = hrefState(link.href)
            return (
              <div key={index} className="space-y-2 rounded border border-border p-3">
                <ItemControls
                  label={'رابط ' + String(index + 1)}
                  index={index}
                  count={draft.footerLinks.length}
                  disabled={!mutationsOn}
                  onMove={(delta) => touch({ ...draft, footerLinks: moveItem(draft.footerLinks, index, delta) })}
                  onRemove={() =>
                    touch({ ...draft, footerLinks: draft.footerLinks.filter((_, position) => position !== index) })
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
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
                    placeholder="/... أو https://..."
                  />
                </Field>
                </div>
              </div>
            )
          })}
          <AddItemButton
            label="ضيف رابط"
            count={draft.footerLinks.length}
            max={10}
            disabled={!mutationsOn}
            onClick={() => touch({ ...draft, footerLinks: [...draft.footerLinks, { label: '', href: '' }] })}
          />
        </div>

        <Field htmlFor="trust" label="سطر الطمأنة" className="mt-4" hint="بيظهر تحت ملخص الطلب">
          <input id="trust" value={draft.trustLine} onChange={(e) => touch({ ...draft, trustLine: e.target.value })} className={inputClasses} />
        </Field>
      </Card>

      {storefrontHref !== null ? (
        <a
          href={storefrontHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          شوف المتجر
        </a>
      ) : (
        <p role="status" className="flex items-start gap-1.5 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{STOREFRONT_LINK_NOT_SET}</span>
        </p>
      )}

      <FailureBanner failure={failure} onRetry={retry} onDiscardAndRefresh={() => router.refresh()} />

      <SaveBar state={state} onSave={save} warning={warning} />
    </div>
  )
}

function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  const a = list[index]
  const b = list[target]
  if (a === undefined || b === undefined) return list
  const copy = [...list]
  copy[index] = b
  copy[target] = a
  return copy
}

/** عنوان العنصر + ترتيب لفوق/لتحت + حذف. */
function ItemControls({
  label,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  label: string
  index: number
  count: number
  disabled: boolean
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label={'حرّك ' + label + ' لفوق'} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={'حرّك ' + label + ' لتحت'}
          disabled={disabled || index === count - 1}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={'احذف ' + label} disabled={disabled} onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </div>
    </div>
  )
}

/** زرار إضافة — بيتقفل عند الحد اللي السيرفر بيقبله. */
function AddItemButton({
  label,
  count,
  max,
  disabled,
  onClick,
}: {
  label: string
  count: number
  max: number
  disabled: boolean
  onClick: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" disabled={disabled || count >= max} onClick={onClick}>
        <Plus className="h-3.5 w-3.5" />
        {label}
      </Button>
      <span className="text-xs text-muted">{String(count) + ' من ' + String(max)}</span>
    </div>
  )
}
