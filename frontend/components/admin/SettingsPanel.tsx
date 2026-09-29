import { useEffect, useState } from 'react'
import { Loader2, Save, Trash2, Plus } from 'lucide-react'
import type { AdminSettings, SettingsSavePayload } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import { Input } from '../../lib/shadcn/input'
import { Label } from '../../lib/shadcn/label'
import { Textarea } from '../../lib/shadcn/textarea'

type SettingsPanelProps = {
  settings: AdminSettings | null
  saving: boolean
  message: { kind: 'ok' | 'error'; text: string } | null
  onSave: (values: SettingsSavePayload) => void
}

type RateRow = { governorate: string; pounds: string }

export function SettingsPanel({ settings, saving, message, onSave }: SettingsPanelProps) {
  const [storeName, setStoreName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [offerText, setOfferText] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [whatsappMessage, setWhatsappMessage] = useState('')
  const [notifyEmail, setNotifyEmail] = useState('')
  const [defaultShipping, setDefaultShipping] = useState('')
  const [freeThreshold, setFreeThreshold] = useState('')
  const [rates, setRates] = useState<RateRow[]>([])
  const [testimonialsText, setTestimonialsText] = useState('')
  const [galleryText, setGalleryText] = useState('')
  const [materialsText, setMaterialsText] = useState('')

  useEffect(() => {
    if (!settings) return
    setStoreName(settings.store_name)
    setLogoUrl(settings.logo_url)
    setOfferText(settings.offer_text)
    setWhatsapp(settings.whatsapp_number)
    setWhatsappMessage(settings.whatsapp_message)
    setNotifyEmail(settings.notify_email)
    setDefaultShipping(String(settings.shipping_default_piastres / 100))
    setFreeThreshold(String(settings.free_shipping_threshold_piastres / 100))
    setRates(
      Object.entries(settings.shipping_rates)
        .sort((a, b) => a[0].localeCompare(b[0], 'ar'))
        .map(([governorate, piastres]) => ({ governorate, pounds: String(piastres / 100) })),
    )
    setTestimonialsText(
      (settings.testimonials ?? []).map((t) => `${t.name} | ${t.area} | ${t.text}`).join('\n'),
    )
    setGalleryText((settings.gallery ?? []).map((g) => `${g.before} | ${g.after} | ${g.caption}`).join('\n'))
    setMaterialsText((settings.materials ?? []).map((m) => `${m.image} | ${m.caption}`).join('\n'))
  }, [settings])

  const toPiastres = (pounds: string): number => Math.round((Number(pounds) || 0) * 100)

  const handleSave = () => {
    const shipping_rates: Record<string, number> = {}
    for (const row of rates) {
      const name = row.governorate.trim()
      if (!name) continue
      shipping_rates[name] = toPiastres(row.pounds)
    }
    onSave({
      store_name: storeName,
      logo_url: logoUrl,
      offer_text: offerText,
      whatsapp_number: whatsapp,
      whatsapp_message: whatsappMessage,
      notify_email: notifyEmail,
      shipping_default_piastres: toPiastres(defaultShipping),
      free_shipping_threshold_piastres: toPiastres(freeThreshold),
      shipping_rates,
      testimonials: parseLines(testimonialsText, (parts) => ({
        name: parts[0] ?? '',
        area: parts[1] ?? '',
        text: parts[2] ?? '',
      })),
      gallery: parseLines(galleryText, (parts) => ({
        before: parts[0] ?? '',
        after: parts[1] ?? '',
        caption: parts[2] ?? '',
      })),
      materials: parseLines(materialsText, (parts) => ({
        image: parts[0] ?? '',
        caption: parts[1] ?? '',
      })),
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-card-foreground">المتجر والتواصل</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="اسم المتجر" value={storeName} onChange={setStoreName} />
          <Row label="رابط اللوجو (اختياري)" value={logoUrl} onChange={setLogoUrl} ltr />
          <Row label="نص العرض في الهيرو" value={offerText} onChange={setOfferText} />
          <Row label="رقم واتساب (بصيغة 20…)" value={whatsapp} onChange={setWhatsapp} ltr />
          <Row label="رسالة واتساب الجاهزة" value={whatsappMessage} onChange={setWhatsappMessage} />
          <Row label="إيميل إشعارات الطلبات" value={notifyEmail} onChange={setNotifyEmail} ltr />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-card-foreground">الشحن</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="الشحن الافتراضي (ج.م)" value={defaultShipping} onChange={setDefaultShipping} ltr />
          <Row label="شحن مجاني فوق (ج.م، صفر = مقفول)" value={freeThreshold} onChange={setFreeThreshold} ltr />
        </div>

        <h4 className="mt-6 text-sm font-semibold text-card-foreground">الشحن حسب المحافظة</h4>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rates.map((row, index) => (
            <div key={`${row.governorate}-${index}`} className="flex items-center gap-2">
              <Input
                value={row.governorate}
                onChange={(e) =>
                  setRates((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, governorate: e.target.value } : r)),
                  )
                }
                className="flex-1"
              />
              <Input
                dir="ltr"
                inputMode="decimal"
                value={row.pounds}
                onChange={(e) =>
                  setRates((prev) => prev.map((r, i) => (i === index ? { ...r, pounds: e.target.value } : r)))
                }
                className="w-24 text-left"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`احذف ${row.governorate}`}
                onClick={() => setRates((prev) => prev.filter((_r, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setRates((prev) => [...prev, { governorate: '', pounds: '0' }])}
        >
          <Plus className="ml-2 h-4 w-4" />
          أضف محافظة
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-card-foreground">آراء العملاء ومعرض قبل/بعد</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          القسمين دول مابيظهروش في صفحة البيع إلا لما تتملي بمحتوى حقيقي.
        </p>

        <Label className="mb-2 mt-4 block">آراء العملاء — كل سطر: الاسم | المنطقة | الرأي</Label>
        <Textarea
          rows={4}
          value={testimonialsText}
          onChange={(e) => setTestimonialsText(e.target.value)}
          placeholder={'محمد علي | الشيخ زايد | ركبته في نص ساعة والفرق في الحرارة واضح'}
        />

        <Label className="mb-2 mt-4 block">معرض الصور — كل سطر: رابط قبل | رابط بعد | الوصف</Label>
        <Textarea
          rows={4}
          dir="ltr"
          className="text-left"
          value={galleryText}
          onChange={(e) => setGalleryText(e.target.value)}
          placeholder={'https://.../before.jpg | https://.../after.jpg | شباك صالة — المعادي'}
        />

        <Label className="mb-2 mt-4 block">خامات أصلية — كل سطر: رابط الصورة | الوصف</Label>
        <Textarea
          rows={3}
          dir="ltr"
          className="text-left"
          value={materialsText}
          onChange={(e) => setMaterialsText(e.target.value)}
          placeholder={'https://.../roll.jpg | رول 3M أصلي'}
        />
      </section>

      {message ? (
        <p
          className={`rounded-md px-4 py-3 text-sm ${
            message.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <Button onClick={handleSave} disabled={saving || !settings}>
        {saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
        حفظ الإعدادات
      </Button>
    </div>
  )
}

/** كل سطر بيتقسم على | لثلاث أجزاء. */
function parseLines<T>(text: string, build: (parts: string[]) => T): T[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => build(line.split('|').map((part) => part.trim())))
}

function Row({
  label,
  value,
  onChange,
  ltr,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  ltr?: boolean
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(ltr ? { dir: 'ltr' as const, className: 'text-left' } : {})}
      />
    </div>
  )
}
