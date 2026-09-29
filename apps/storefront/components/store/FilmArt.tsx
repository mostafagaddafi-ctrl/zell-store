import { Moon, ShieldCheck, Sun, EyeOff } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * رسمة احتياطية للمنتج — مرحلة ١.
 *
 * مش صورة وهمية ولا stock photo: دي شكل توضيحي لشباك بالفيلم، مبني
 * بالكامل من طبقات CSS وأيقونة. أول ما الصور الحقيقية تترفع على
 * Supabase Storage في المرحلة الجاية، الكومبوننت ده بيبقى fallback بس.
 */

export type FilmVariant = 'heat' | 'frosted' | 'smoked' | 'safety'

export function variantForProduct(nameAr: string, nameEn: string | null): FilmVariant {
  const text = (nameAr + ' ' + (nameEn ?? '')).toLowerCase()
  if (text.includes('مصنفر') || text.includes('مطفي') || text.includes('frost')) return 'frosted'
  if (text.includes('فاميه') || text.includes('أسود') || text.includes('smoke')) return 'smoked'
  if (text.includes('عازل') || text.includes('حرار') || text.includes('heat')) return 'heat'
  if (text.includes('أمان') || text.includes('يتكسر') || text.includes('safety')) return 'safety'
  return 'heat'
}

const GLASS: Record<FilmVariant, string> = {
  heat: 'bg-gradient-to-bl from-amber-200/80 via-sky-200/70 to-sky-400/60',
  frosted: 'bg-gradient-to-bl from-slate-100/90 via-slate-200/80 to-slate-300/70 backdrop-blur',
  smoked: 'bg-gradient-to-bl from-slate-700/80 via-slate-800/85 to-slate-900/90',
  safety: 'bg-gradient-to-bl from-teal-200/70 via-cyan-200/60 to-teal-400/50',
}

const ICONS: Record<FilmVariant, typeof Sun> = {
  heat: Sun,
  frosted: EyeOff,
  smoked: Moon,
  safety: ShieldCheck,
}

const LABELS: Record<FilmVariant, string> = {
  heat: 'عازل للحرارة والوهج',
  frosted: 'خصوصية مع دخول النور',
  smoked: 'تعتيم وخصوصية كاملة',
  safety: 'أمان ضد تطاير الشظايا',
}

export function FilmArt({ variant, className }: { variant: FilmVariant; className?: string }) {
  const Icon = ICONS[variant]

  return (
    <div
      aria-hidden="true"
      className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)}
    >
      {/* الحائط حوالين الشباك */}
      <div className="absolute inset-0 bg-gradient-to-b from-border/30 to-border/60" />

      {/* الشباك */}
      <div className="absolute inset-[12%] rounded-md border-2 border-border/80 bg-bg shadow-inner">
        <div className={cn('absolute inset-0 rounded-sm', GLASS[variant])} />

        {/* قوايم الشباك */}
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-border/70" />
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-border/70" />

        {/* انعكاس ضوء خفيف */}
        <div className="absolute -inset-y-4 right-[18%] w-1/4 rotate-12 bg-white/25" />
      </div>

      {/* شارة النوع */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-card/90 px-2 py-1 shadow-sm">
        <Icon className="h-3.5 w-3.5 text-brand" />
        <span className="text-[11px] font-semibold text-fg">{LABELS[variant]}</span>
      </div>
    </div>
  )
}
