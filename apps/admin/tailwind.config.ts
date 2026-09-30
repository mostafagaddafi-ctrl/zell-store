import type { Config } from 'tailwindcss'

/**
 * نفس هوية ZELL بس بكثافة تشغيلية:
 * صفوف أقصر، مسافات أضيق، حواف أصغر، ونص أصغر من المتجر.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        fg: 'hsl(var(--fg) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        brand: 'hsl(var(--brand) / <alpha-value>)',
        'brand-fg': 'hsl(var(--brand-fg) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        gold: 'hsl(var(--gold) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        ok: 'hsl(var(--ok) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-cairo)', 'system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '6px',
        '2xl': '8px',
      },
      spacing: {
        sidebar: '16rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(18 35 58 / 0.05)',
        pop: '0 8px 24px -6px rgb(18 35 58 / 0.18)',
      },
    },
  },
  plugins: [],
}

export default config
