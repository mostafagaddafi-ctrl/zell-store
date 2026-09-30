import 'server-only'

import type { FaqItem, FooterLink, HeroContent, OrderStep, StoreContent, StoreSection } from '../adminData'
import { SECTION_KEYS, type SectionKey } from '../enums'
import { flag, invalid, optionalText, requiredText, wholeNumber, type ValidationFailure } from './shared'

/**
 * تحقق محتوى المتجر.
 *
 * ⚠️ zell_save_content **مابتتحققش من شكل الـ jsonb خالص** — بتقارن
 * النسخة وبتكتب. يعني الملف ده هو **الحارس الوحيد** لشكل المحتوى.
 * أي تراخي هنا بيوصل للمتجر على طول.
 *
 * الحدود دي اختيار معقول مش حدود من الداتابيز — كلها أوسع بكتير من
 * القيم الموجودة حاليًا في Production.
 */

export type ContentInput = Omit<StoreContent, 'updatedAt'>

/** الشكل اللي بيتبعت للدالة — مطابق للشكل اللي طبقة القراءة بتتوقعه. */
export type ContentPayload = {
  hero: HeroContent
  orderSteps: OrderStep[]
  faqs: FaqItem[]
  sections: StoreSection[]
  footerLinks: FooterLink[]
  trustLine: string
}

const MAX_STEPS = 8
const MAX_FAQS = 30
const MAX_FOOTER_LINKS = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateHero(value: unknown): { ok: true; value: HeroContent } | ValidationFailure {
  if (!isRecord(value)) return invalid('بيانات الواجهة الرئيسية ناقصة')

  const title = requiredText(value['title'], 'عنوان الواجهة', 2, 120)
  if (!title.ok) return title
  const accent = optionalText(value['accent'], 'الكلمة المميزة', 60)
  if (!accent.ok) return accent
  const subtitle = optionalText(value['subtitle'], 'نص الواجهة', 400)
  if (!subtitle.ok) return subtitle
  const ctaLabel = optionalText(value['ctaLabel'], 'نص زرار الواجهة', 60)
  if (!ctaLabel.ok) return ctaLabel

  const hero: HeroContent = {
    title: title.value,
    accent: accent.value ?? '',
    subtitle: subtitle.value ?? '',
    ctaLabel: ctaLabel.value ?? '',
  }
  return { ok: true, value: hero }
}

function validateSteps(value: unknown): { ok: true; value: OrderStep[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('خطوات الطلب لازم تكون قائمة')
  if (value.length > MAX_STEPS) return invalid('أقصى عدد خطوات هو ' + String(MAX_STEPS))

  const out: OrderStep[] = []
  for (const item of value) {
    if (!isRecord(item)) return invalid('كل خطوة لازم تكون عنوان ووصف')
    const title = requiredText(item['title'], 'عنوان الخطوة', 2, 120)
    if (!title.ok) return title
    const description = optionalText(item['description'], 'وصف الخطوة', 300)
    if (!description.ok) return description
    out.push({ title: title.value, description: description.value ?? '' })
  }
  return { ok: true, value: out }
}

function validateFaqs(value: unknown): { ok: true; value: FaqItem[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('الأسئلة لازم تكون قائمة')
  if (value.length > MAX_FAQS) return invalid('أقصى عدد أسئلة هو ' + String(MAX_FAQS))

  const out: FaqItem[] = []
  for (const item of value) {
    if (!isRecord(item)) return invalid('كل سؤال لازم يكون سؤال وجواب')
    const question = requiredText(item['question'], 'السؤال', 2, 300)
    if (!question.ok) return question
    const answer = requiredText(item['answer'], 'الجواب', 2, 2000)
    if (!answer.ok) return answer
    out.push({ question: question.value, answer: answer.value })
  }
  return { ok: true, value: out }
}

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value)
}

function validateSections(value: unknown): { ok: true; value: StoreSection[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('الأقسام لازم تكون قائمة')
  if (value.length > SECTION_KEYS.length) return invalid('في أقسام أكتر من المعروفة')

  const seen = new Set<string>()
  const out: StoreSection[] = []

  for (const item of value) {
    if (!isRecord(item)) return invalid('بيانات قسم ناقصة')

    const key = item['key']
    if (!isSectionKey(key)) return invalid('في قسم بمفتاح غير معروف')
    if (seen.has(key)) return invalid('في قسم مكرر')
    seen.add(key)

    const visible = flag(item['visible'], 'إظهار القسم')
    if (!visible.ok) return visible

    const sortOrder = wholeNumber(item['sortOrder'], 'ترتيب القسم')
    if (!sortOrder.ok) return sortOrder
    if (sortOrder.value < 0) return invalid('ترتيب القسم ماينفعش يكون سالب')

    const title = optionalText(item['title'], 'عنوان القسم', 200)
    if (!title.ok) return title
    const subtitle = optionalText(item['subtitle'], 'وصف القسم', 200)
    if (!subtitle.ok) return subtitle

    // المفاتيح الفاضية **بتتشال** مش بتتحفظ نص فاضي — نفس الشكل الحالي
    const section: StoreSection = { key, visible: visible.value, sortOrder: sortOrder.value }
    if (title.value !== null) section.title = title.value
    if (subtitle.value !== null) section.subtitle = subtitle.value
    out.push(section)
  }

  return { ok: true, value: out }
}

/** الرابط لازم يبقى داخلي أو https — منع حقن javascript: و data:. */
function validHref(href: string): boolean {
  if (href === '') return true
  if (href.startsWith('//')) return false
  if (href.startsWith('/')) return true
  return href.startsWith('https://')
}

function validateFooterLinks(value: unknown): { ok: true; value: FooterLink[] } | ValidationFailure {
  if (!Array.isArray(value)) return invalid('روابط الفوتر لازم تكون قائمة')
  if (value.length > MAX_FOOTER_LINKS) return invalid('أقصى عدد روابط هو ' + String(MAX_FOOTER_LINKS))

  const out: FooterLink[] = []
  for (const item of value) {
    if (!isRecord(item)) return invalid('بيانات رابط ناقصة')
    const label = requiredText(item['label'], 'نص الرابط', 1, 80)
    if (!label.ok) return label
    const href = optionalText(item['href'], 'الرابط', 300)
    if (!href.ok) return href
    const target = href.value ?? ''
    if (!validHref(target)) return invalid('الرابط لازم يبدأ بشرطة واحدة أو https')
    out.push({ label: label.value, href: target })
  }
  return { ok: true, value: out }
}

export function validateContent(input: ContentInput): { ok: true; payload: ContentPayload } | ValidationFailure {
  const hero = validateHero(input.hero)
  if (!hero.ok) return hero

  const orderSteps = validateSteps(input.orderSteps)
  if (!orderSteps.ok) return orderSteps

  const faqs = validateFaqs(input.faqs)
  if (!faqs.ok) return faqs

  const sections = validateSections(input.sections)
  if (!sections.ok) return sections

  const footerLinks = validateFooterLinks(input.footerLinks)
  if (!footerLinks.ok) return footerLinks

  const trustLine = optionalText(input.trustLine, 'سطر الطمأنة', 200)
  if (!trustLine.ok) return trustLine

  const payload: ContentPayload = {
    hero: hero.value,
    orderSteps: orderSteps.value,
    faqs: faqs.value,
    sections: sections.value,
    footerLinks: footerLinks.value,
    trustLine: trustLine.value ?? '',
  }
  return { ok: true, payload }
}
