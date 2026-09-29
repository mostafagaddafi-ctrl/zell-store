/**
 * رسومات SVG لكل نوع فيلم — مرسومة داخل التطبيق (مفيش صور خارجية تقع).
 * الألوان من هوية ZELL: كحلي + تركوازي + ذهبي.
 */

export type FilmKind = 'heat' | 'privacy' | 'mirror' | 'safety'

const NAVY = '#12304f'
const NAVY_SOFT = '#1d4a6e'
const TEAL = '#2aa5a0'
const GOLD = '#d9a441'

/** يحدد نوع الرسمة من اسم المنتج (عربي أو إنجليزي) مع بديل بالترتيب. */
export function guessFilmKind(nameAr: string, nameEn: string | null, index: number): FilmKind {
  const text = `${nameAr} ${nameEn ?? ''}`.toLowerCase()
  if (text.includes('حرار') || text.includes('شمس') || text.includes('heat') || text.includes('solar')) return 'heat'
  if (text.includes('خصوصي') || text.includes('مطفي') || text.includes('frost') || text.includes('privacy')) {
    return 'privacy'
  }
  if (text.includes('عاكس') || text.includes('مراي') || text.includes('mirror')) return 'mirror'
  if (text.includes('أمان') || text.includes('امان') || text.includes('safety') || text.includes('security')) {
    return 'safety'
  }
  const order: FilmKind[] = ['heat', 'privacy', 'mirror', 'safety']
  return order[index % order.length] as FilmKind
}

export function FilmIllustration({ kind, className }: { kind: FilmKind; className?: string }) {
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className={className} role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id={`glass-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bfe9e6" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={`sky-${kind}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe9f5" />
          <stop offset="100%" stopColor="#eaf4f7" />
        </linearGradient>
      </defs>

      {/* الحيطة */}
      <rect width="400" height="300" fill="#f3efe9" />
      <rect x="0" y="252" width="400" height="48" fill="#e6dfd4" />

      {/* السماء جوه الشباك */}
      <rect x="70" y="40" width="260" height="200" rx="6" fill={`url(#sky-${kind})`} />

      {kind === 'heat' ? <HeatScene /> : null}
      {kind === 'privacy' ? <PrivacyScene /> : null}
      {kind === 'mirror' ? <MirrorScene /> : null}
      {kind === 'safety' ? <SafetyScene /> : null}

      {/* الزجاج بالفيلم */}
      <rect x="70" y="40" width="260" height="200" rx="6" fill={`url(#glass-${kind})`} opacity="0.5" />

      {/* برواز الشباك */}
      <rect x="64" y="34" width="272" height="212" rx="8" fill="none" stroke={NAVY} strokeWidth="10" />
      <rect x="196" y="40" width="8" height="200" fill={NAVY} />
      <rect x="70" y="136" width="260" height="8" fill={NAVY_SOFT} opacity="0.85" />

      {/* رف الشباك ونباتة صغيرة للإحساس المنزلي */}
      <rect x="52" y="246" width="296" height="10" rx="5" fill={NAVY_SOFT} />
      <g>
        <rect x="286" y="222" width="30" height="24" rx="4" fill={GOLD} />
        <path d="M301 222c-12-4-16-14-14-24 10 0 18 8 18 18z" fill={TEAL} />
        <path d="M301 222c10-6 12-16 9-25-9 2-15 11-14 20z" fill="#3cc0b9" />
      </g>
    </svg>
  )
}

/** حرارة الشمس: أشعة قوية بره وخافتة جوه. */
function HeatScene() {
  return (
    <g>
      <circle cx="120" cy="86" r="26" fill={GOLD} opacity="0.95" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x="146"
          y={70 + i * 12}
          width="52"
          height="5"
          rx="2.5"
          fill={GOLD}
          opacity={0.85 - i * 0.05}
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={`in-${i}`} x="212" y={70 + i * 12} width="34" height="5" rx="2.5" fill={GOLD} opacity="0.16" />
      ))}
      <path d="M250 180c10-10 10-20 0-30s-10-20 0-30" stroke={TEAL} strokeWidth="5" fill="none" opacity="0.7" />
      <path d="M276 190c10-10 10-20 0-30s-10-20 0-30" stroke={TEAL} strokeWidth="5" fill="none" opacity="0.45" />
    </g>
  )
}

/** خصوصية: شريحة مطفية والظل اللي بره مش باين. */
function PrivacyScene() {
  return (
    <g>
      <g opacity="0.45">
        <circle cx="150" cy="120" r="20" fill={NAVY_SOFT} />
        <path d="M118 200c0-22 14-40 32-40s32 18 32 40z" fill={NAVY_SOFT} />
      </g>
      <rect x="70" y="40" width="260" height="200" fill="#ffffff" opacity="0.62" />
      {Array.from({ length: 11 }).map((_, i) => (
        <rect key={i} x="70" y={46 + i * 18} width="260" height="6" fill="#ffffff" opacity="0.5" />
      ))}
      <circle cx="268" cy="96" r="20" fill={GOLD} opacity="0.35" />
    </g>
  )
}

/** مراية من بره: انعكاس سماء ومباني على السطح. */
function MirrorScene() {
  return (
    <g>
      <rect x="70" y="40" width="260" height="200" fill="#9fc6d8" opacity="0.75" />
      <g opacity="0.6" fill="#ffffff">
        <rect x="96" y="150" width="34" height="90" />
        <rect x="140" y="120" width="28" height="120" />
        <rect x="222" y="138" width="36" height="102" />
        <rect x="270" y="168" width="26" height="72" />
      </g>
      <circle cx="286" cy="86" r="22" fill={GOLD} opacity="0.75" />
      <path d="M96 240l70-96 54 96z" fill="#ffffff" opacity="0.28" />
      <path d="M78 60l60 36-60 34z" fill="#ffffff" opacity="0.5" />
    </g>
  )
}

/** أمان: الزجاج اتكسر بس الشظايا ماسكة مكانها. */
function SafetyScene() {
  return (
    <g>
      <circle cx="200" cy="140" r="14" fill="#ffffff" opacity="0.85" />
      <g stroke={NAVY} strokeWidth="2.5" opacity="0.55" fill="none">
        <path d="M200 140L120 60M200 140L290 68M200 140L110 210M200 140L300 205M200 140L200 232M200 140L86 140M200 140L318 132" />
        <path d="M170 110l64-12 44 42-38 54-72 8-36-50z" />
        <path d="M146 84l108-18 62 58-50 76-102 12-52-70z" opacity="0.7" />
      </g>
      <circle cx="120" cy="86" r="18" fill={GOLD} opacity="0.5" />
    </g>
  )
}
