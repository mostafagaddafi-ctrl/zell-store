import type { Config } from 'tailwindcss'

/**
 * الألوان مكتوبة بصيغة hsl(var(--x) / <alpha-value>) عن قصد:
 * من غير alpha-value أي كلاس فيه شفافية (bg-gold/15، ring-brand/25) بيتجاهل
 * بصمت من غير أي خطأ في البناء — وده أسوأ نوع من الأخطاء.
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
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      maxWidth: {
        app: '32rem',
      },
    },
  },
  plugins: [],
}

export default config
