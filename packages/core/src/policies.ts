/**
 * POLICY-PAGES (docs/contracts/POLICY-PAGES.md) — صفحات السياسات: المفاتيح والحدود والقراية والتحقق.
 *
 * - المتجر (parsePublishedPolicies): كل صفحة بتتقيّم لوحدها، ومنشورة بس لو enabled === true والعنوان والنص صالحين.
 *   غير كده مقفولة من غير أي محتوى، ومفيش رجوع لنص افتراضي في المتجر خالص (§٢ و§٣).
 * - المحرر (readPolicyDrafts): النص الافتراضي (policyDrafts.ts) بداية بس لما الحقل غايب أو فاسد، والمفتاح مقفول.
 * - الحفظ (buildPolicyPages): نفس الحدود على السيرفر، و«آخر تحديث» للصفحة اللي اتغيّرت بس؛ بيانات البائع بتحدّث terms بس.
 * - النص عادي (من غير HTML ولا markdown): سطر فاضي = فقرة، وسطر بيبدأ بـ «- » = بند (splitPolicyBody).
 */

export const POLICY_KEYS = ['terms', 'shipping', 'returns', 'privacy'] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

/** مفتاح settings — قيمة عامة كلها (بيتقرا في المتجر من PUBLIC_SETTING_KEYS). */
export const POLICY_PAGES_SETTING_KEY = 'policy_pages'

export const POLICY_LIMITS = { title: 80, body: 8000, bodyLines: 300, company: 200 } as const

export const POLICY_COMPANY_FIELDS = ['name', 'address', 'commercialRegister', 'taxNumber'] as const
export type PolicyCompanyField = (typeof POLICY_COMPANY_FIELDS)[number]
export type PolicyCompany = Record<PolicyCompanyField, string>

export const POLICY_PAGE_LABELS: Record<PolicyKey, string> = {
  terms: 'الشروط والأحكام',
  shipping: 'الشحن والتوصيل',
  returns: 'الاستبدال والاسترجاع',
  privacy: 'سياسة الخصوصية',
}

export const POLICY_COMPANY_LABELS: Record<PolicyCompanyField, string> = {
  name: 'اسم الشركة',
  address: 'العنوان',
  commercialRegister: 'رقم السجل التجاري',
  taxNumber: 'رقم التسجيل الضريبي',
}

export const EMPTY_POLICY_COMPANY: PolicyCompany = { name: '', address: '', commercialRegister: '', taxNumber: '' }

export type PolicyPage = { enabled: boolean; title: string; body: string; updatedAt: string | null }
export type PolicyPages = { company: PolicyCompany; pages: Record<PolicyKey, PolicyPage> }

export type PublishedPolicy = { key: PolicyKey; title: string; body: string; updatedAt: string | null }
export type PublishedPolicies = { pages: Partial<Record<PolicyKey, PublishedPolicy>>; company: PolicyCompany }

export const NO_PUBLISHED_POLICIES: PublishedPolicies = { pages: {}, company: EMPTY_POLICY_COMPANY }

export function isPolicyKey(value: unknown): value is PolicyKey {
  return typeof value === 'string' && (POLICY_KEYS as readonly string[]).includes(value)
}

export function policyPath(key: PolicyKey): string {
  return '/policies/' + key
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** العنوان صالح = نص، وبعد trim من 1 لـ 80 حرف. */
export function policyTitleValid(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return text.length >= 1 && text.length <= POLICY_LIMITS.title
}

export type PolicyBodyIssue = 'type' | 'empty' | 'long' | 'lines'

/** null = النص صالح للنشر. 'empty' = نص فاضي (مسموح بس والصفحة مقفولة). */
export function policyBodyIssue(value: unknown): PolicyBodyIssue | null {
  if (typeof value !== 'string') return 'type'
  const text = normalizeNewlines(value).trim()
  if (text.length > POLICY_LIMITS.body) return 'long'
  if (text.split('\n').length > POLICY_LIMITS.bodyLines) return 'lines'
  if (text === '') return 'empty'
  return null
}

function updatedAtOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value)) ? value : null
}

/** حقل بائع صالح = نص لحد 200 حرف بعد trim؛ الفاسد بيبقى فاضي (بيتخفي لوحده). */
function companyOf(value: unknown): PolicyCompany {
  const record = asRecord(value)
  const company: PolicyCompany = { ...EMPTY_POLICY_COMPANY }
  if (!record) return company
  for (const field of POLICY_COMPANY_FIELDS) {
    const item = record[field]
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text.length <= POLICY_LIMITS.company) company[field] = text
  }
  return company
}

/** قراية المتجر (§٢ و§٣). الإعداد كله مش object = الأربعة مقفولين. */
export function parsePublishedPolicies(raw: unknown): PublishedPolicies {
  const root = asRecord(raw)
  if (!root) return NO_PUBLISHED_POLICIES
  const pagesRaw = asRecord(root['pages'])
  const pages: Partial<Record<PolicyKey, PublishedPolicy>> = {}
  if (pagesRaw) {
    for (const key of POLICY_KEYS) {
      const page = asRecord(pagesRaw[key])
      if (!page || page['enabled'] !== true) continue
      const title = page['title']
      const body = page['body']
      if (!policyTitleValid(title) || policyBodyIssue(body) !== null || typeof body !== 'string') continue
      pages[key] = { key, title: title.trim(), body: normalizeNewlines(body).trim(), updatedAt: updatedAtOf(page['updatedAt']) }
    }
  }
  return { pages, company: companyOf(root['company']) }
}

/** المفاتيح المنشورة بالترتيب الثابت — للـ sitemap. */
export function publishedPolicyKeys(published: PublishedPolicies): PolicyKey[] {
  return POLICY_KEYS.filter((key) => published.pages[key] !== undefined)
}

/** صفوف «بيانات البائع» المليانة بالترتيب الثابت. */
export function policyCompanyRows(company: PolicyCompany): Array<{ label: string; value: string }> {
  return POLICY_COMPANY_FIELDS.filter((field) => company[field] !== '').map((field) => ({
    label: POLICY_COMPANY_LABELS[field],
    value: company[field],
  }))
}

/**
 * قراية المحرر: القيمة المخزّنة زي ما هي لو صالحة. العنوان أو النص الغايب أو الفاسد = النص الافتراضي كبداية،
 * والصفحة بتتقفل. التفعيل بيتقرا بنفس شرط النشر بالظبط.
 */
export function readPolicyDrafts(raw: unknown, drafts: Record<PolicyKey, { title: string; body: string }>): PolicyPages {
  const root = asRecord(raw)
  const pagesRaw = root ? asRecord(root['pages']) : null
  const pages = {} as Record<PolicyKey, PolicyPage>
  for (const key of POLICY_KEYS) {
    const page = pagesRaw ? asRecord(pagesRaw[key]) : null
    const title = page ? page['title'] : undefined
    const body = page ? page['body'] : undefined
    const titleOk = policyTitleValid(title)
    const bodyIssue = policyBodyIssue(body)
    const bodyOk = typeof body === 'string' && (bodyIssue === null || bodyIssue === 'empty')
    pages[key] = {
      enabled: page !== null && page['enabled'] === true && titleOk && bodyIssue === null,
      title: titleOk ? (title as string).trim() : drafts[key].title,
      body: bodyOk ? normalizeNewlines(body as string).trim() : drafts[key].body,
      updatedAt: page ? updatedAtOf(page['updatedAt']) : null,
    }
  }
  return { company: companyOf(root ? root['company'] : undefined), pages }
}

export type PolicyBuildResult = { ok: true; value: PolicyPages } | { ok: false; code: 'VALIDATION'; message: string }

function invalid(message: string): PolicyBuildResult {
  return { ok: false, code: 'VALIDATION', message }
}

/**
 * تحقق الحفظ على السيرفر (§٣ و§٤). stored = المخزّن دلوقتي (أو null لو مفيش صف)؛ nowIso = وقت الحفظ.
 * «آخر تحديث» بيتغيّر للصفحة اللي التفعيل أو العنوان أو النص بتاعها اتغيّر بس، وتغيير بيانات البائع بيحدّث terms بس.
 */
export function buildPolicyPages(raw: unknown, stored: PolicyPages | null, nowIso: string): PolicyBuildResult {
  const root = asRecord(raw)
  if (!root) return invalid('البيانات غير صحيحة.')
  const companyRaw = asRecord(root['company'])
  const pagesRaw = asRecord(root['pages'])
  if (!companyRaw || !pagesRaw) return invalid('البيانات غير صحيحة.')

  const company: PolicyCompany = { ...EMPTY_POLICY_COMPANY }
  for (const field of POLICY_COMPANY_FIELDS) {
    const item = companyRaw[field]
    if (typeof item !== 'string') return invalid('حقل «' + POLICY_COMPANY_LABELS[field] + '» غير صحيح.')
    const text = item.trim()
    if (text.length > POLICY_LIMITS.company) {
      return invalid('حقل «' + POLICY_COMPANY_LABELS[field] + '» أطول من ' + String(POLICY_LIMITS.company) + ' حرف.')
    }
    company[field] = text
  }
  const companyChanged = stored === null || POLICY_COMPANY_FIELDS.some((field) => stored.company[field] !== company[field])

  const pages = {} as Record<PolicyKey, PolicyPage>
  for (const key of POLICY_KEYS) {
    const label = POLICY_PAGE_LABELS[key]
    const page = asRecord(pagesRaw[key])
    if (!page) return invalid('بيانات صفحة «' + label + '» غير صحيحة.')
    const enabled = page['enabled']
    if (typeof enabled !== 'boolean') return invalid('مفتاح إظهار صفحة «' + label + '» غير صحيح.')
    const titleRaw = page['title']
    if (typeof titleRaw !== 'string') return invalid('عنوان صفحة «' + label + '» غير صحيح.')
    const title = titleRaw.trim()
    if (title === '') return invalid('اكتب عنوان صفحة «' + label + '».')
    if (title.length > POLICY_LIMITS.title) return invalid('عنوان صفحة «' + label + '» أطول من ' + String(POLICY_LIMITS.title) + ' حرفًا.')
    const bodyRaw = page['body']
    const issue = policyBodyIssue(bodyRaw)
    if (issue === 'type' || typeof bodyRaw !== 'string') return invalid('نص صفحة «' + label + '» غير صحيح.')
    if (issue === 'long') return invalid('نص صفحة «' + label + '» أطول من ' + String(POLICY_LIMITS.body) + ' حرف.')
    if (issue === 'lines') return invalid('نص صفحة «' + label + '» أكثر من ' + String(POLICY_LIMITS.bodyLines) + ' سطر.')
    if (issue === 'empty' && enabled) return invalid('لا يمكن إظهار صفحة «' + label + '» بنص فارغ.')
    const body = normalizeNewlines(bodyRaw).trim()

    const previous = stored === null ? null : stored.pages[key]
    const changed =
      previous === null ||
      previous.enabled !== enabled ||
      previous.title !== title ||
      previous.body !== body ||
      (key === 'terms' && companyChanged)
    pages[key] = { enabled, title, body, updatedAt: changed || previous === null ? nowIso : previous.updatedAt }
  }
  return { ok: true, value: { company, pages } }
}

/** قراءة التأكيد بعد الحفظ: المخزّن = المحفوظ بالظبط. */
export function samePolicyPages(a: PolicyPages, b: PolicyPages): boolean {
  for (const field of POLICY_COMPANY_FIELDS) if (a.company[field] !== b.company[field]) return false
  for (const key of POLICY_KEYS) {
    const x = a.pages[key]
    const y = b.pages[key]
    if (x.enabled !== y.enabled || x.title !== y.title || x.body !== y.body || x.updatedAt !== y.updatedAt) return false
  }
  return true
}

export type PolicyBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/** سطر فاضي = فقرة جديدة · سطر بيبدأ بـ «- » = بند في قايمة · غير كده سطر في نفس الفقرة. */
export function splitPolicyBody(body: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: 'list', items: list })
    list = []
  }
  for (const raw of normalizeNewlines(body).split('\n')) {
    const line = raw.trim()
    if (line === '') {
      flushParagraph()
      flushList()
    } else if (line.startsWith('- ')) {
      flushParagraph()
      list.push(line.slice(2).trim())
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}
