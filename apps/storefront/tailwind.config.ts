import type { Config } from 'tailwindcss'

/**
 * الألوان بصيغة hsl(var(--x) / <alpha-value>) عشان صيغ الشفافية تشتغل.
 *
 * الحواف اتصغّرت عن قصد: كل حاجة كانت rounded-xl (14px) وده أكتر سبب
 * بيدي إحساس «قالب جاهز». الصور 4px، الأسطح 8px.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        fg: 'hsl(var(--fg) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        card: 'hsl(var(--card) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        brand: 'hsl(var(--brand) / <alpha-value>)',
        'brand-fg': 'hsl(var(--brand-fg) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        gold: 'hsl(var(--gold) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-cairo)', 'system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      fontSize: {
        display: ['2rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'display-lg': ['3.25rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '12px',
      },
      maxWidth: {
        app: '34rem', // عمود ضيق للفورمات
        content: '75rem', // ١٢٠٠px — حاوية الديسكتوب
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(18 35 58 / 0.04), 0 1px 3px 0 rgb(18 35 58 / 0.06)',
      },
    },
  },
  plugins: [],
}

export default config
