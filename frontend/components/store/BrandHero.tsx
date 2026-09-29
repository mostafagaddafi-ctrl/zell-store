import { ShieldCheck, Sparkles, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import zellLogo from '../../assets/zell-logo.jpg'
import { Button } from '../../lib/shadcn/button'

/** شريط الهوية: تدرّج كحلي/تركوازي من اللوجو مع لمسة ذهبية. ثابت في الوضعين. */
export function BrandHero({ offerText, onShopClick }: { offerText: string; onShopClick: () => void }) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl px-5 py-7 text-white"
      style=undefined
    >
      <div
        className="pointer-events-none absolute -left-10 -top-14 h-44 w-44 rounded-full opacity-25 blur-2xl"
        style=undefined
        aria-hidden="true"
      />

      <div className="relative flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
          <img src={zellLogo} alt="ZELL" className="h-12 w-12 object-cover" />
        </span>
        <div>
          <h1 className="text-xl font-extrabold leading-8">فيلم زجاج للبيت — على مقاس شباكك</h1>
          <p className="mt-1.5 text-sm leading-6 text-white/85">
            للحرارة والخصوصية والأمان. خامات <span dir="ltr" className="font-bold">3M</span> و{' '}
            <span dir="ltr" className="font-bold">V-KOOL</span> · تركّبه بنفسك في دقايق.
          </p>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Pill icon={<Sparkles className="h-3.5 w-3.5" />} text={offerText || 'أدوات التركيب مجاناً'} gold />
        <Pill icon={<Truck className="h-3.5 w-3.5" />} text="توصيل لكل مصر" />
        <Pill icon={<ShieldCheck className="h-3.5 w-3.5" />} text="دفع عند الاستلام" />
      </div>

      <Button
        onClick={onShopClick}
        className="relative mt-5 h-14 w-full rounded-xl bg-white text-base font-extrabold text-[#12304f] hover:bg-white/90"
      >
        ابدأ — اختار نوع الفيلم
      </Button>
    </section>
  )
}

function Pill({ icon, text, gold = false }: { icon: ReactNode; text: string; gold?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
        gold ? 'bg-[#d9a441] font-semibold text-[#2a1c00]' : 'bg-white/12 text-white/90'
      }`}
    >
      {icon}
      {text}
    </span>
  )
}
