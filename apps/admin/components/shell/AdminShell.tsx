'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AlertTriangle,
  ExternalLink,
  Boxes,
  ClipboardList,
  Factory,
  Receipt,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Tag,
  Truck,
  Wrench,
  PackageOpen,
  X,
  Wallet,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { STOREFRONT_LINK_NOT_SET } from '../../lib/storefront/link'
import { LOGO_LETTER } from '../../lib/brand/logo'
import { LogoMark } from './Logo'
import { SignOutButton } from './SignOutButton'

type Item = { href: string; label: string; icon: typeof Package; badge?: number }
type Group = { title?: string; items: Item[] }

export type AdminShellIdentity = { email: string; role: 'owner' | 'admin' }

export function AdminShell({
  children,
  newOrders,
  identity,
  storefrontHref,
}: {
  children: ReactNode
  newOrders: number
  identity: AdminShellIdentity
  /** رابط «معاينة المتجر» — من السيرفر (lib/storefrontLink.ts). null = الإعداد مش مضبوط: اللينك بيستخبى والتنبيه بيظهر. */
  storefrontHref: string | null
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // وهي مفتوحة: Escape بيقفلها، والصفحة اللي تحتها ماتتحركش مع السكرول
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups: Group[] = [
    { items: [{ href: '/', label: 'نظرة عامة', icon: LayoutDashboard }] },
    { title: 'التشغيل', items: [{ href: '/orders', label: 'الطلبات', icon: ShoppingCart, badge: newOrders }] },
    {
      title: 'الكتالوج',
      items: [
        { href: '/products', label: 'المنتجات', icon: Package },
        { href: '/collections', label: 'الأقسام', icon: Layers },
      ],
    },
    {
      title: 'المتجر',
      items: [
        { href: '/content', label: 'المحتوى', icon: ImageIcon },
        { href: '/shipping', label: 'الشحن', icon: Truck },
        { href: '/installation', label: 'فني التركيب', icon: Wrench },
        { href: '/installation-tools', label: 'أدوات التركيب', icon: PackageOpen },
        { href: '/identity', label: 'الهوية', icon: Store },
        // 0019 — أكواد الخصم للمالك بس (والصفحة والـactions بيتحققوا من الدور على السيرفر)
        ...(identity.role === 'owner' ? [{ href: '/coupons', label: 'أكواد الخصم', icon: Tag }] : []),
        ...(identity.role === 'owner' ? [{ href: '/payments', label: 'الدفع ورسوم التأكيد', icon: Wallet }] : []),
      ],
    },
    // 0020 — المخزون للمالك بس (الصفحة والـactions ودوال الداتابيز نفسها بيتحققوا من الدور)
    ...(identity.role === 'owner'
      ? [
          {
            title: 'المخزون',
            items: [
              { href: '/inventory/purchases', label: 'المشتريات', icon: Receipt },
              { href: '/inventory/openings', label: 'رصيد أول المدة', icon: ClipboardList },
              { href: '/inventory/lots', label: 'دفعات المخزون', icon: Boxes },
              { href: '/inventory/suppliers', label: 'الموردين', icon: Factory },
            ],
          },
        ]
      : []),
    { title: 'النظام', items: [{ href: '/settings', label: 'الإعدادات', icon: Settings }] },
  ]

  // المطابقة على الرابط أو اللي بعده «/» — عشان «/installation» مايتعلّمش في «/installation-tools»
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      <div className="px-2 pt-1">
        <p className="text-sm font-extrabold text-brand">
          <span dir="ltr" className="inline-flex items-center gap-1.5">
            <LogoMark size={20} letter={LOGO_LETTER} />
            ZELL
          </span>
        </p>
        <p className="text-xs text-muted">لوحة التحكم</p>
      </div>

      {groups.map((group, index) => (
        <div key={group.title ?? 'main-' + String(index)} className="space-y-1">
          {group.title ? (
            <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{group.title}</p>
          ) : null}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 rounded px-2 py-2.5 text-sm font-medium transition-colors lg:py-2',
                isActive(item.href) ? 'bg-brand text-brand-fg' : 'text-fg hover:bg-border/50',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-bold',
                    isActive(item.href) ? 'bg-brand-fg/20 text-brand-fg' : 'bg-gold/20 text-fg',
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}

      {storefrontHref !== null ? (
        <a
          href={storefrontHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto flex items-center gap-2 rounded px-2 py-2 text-xs font-medium text-muted transition-colors hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          معاينة المتجر
        </a>
      ) : (
        <p role="status" className="mt-auto flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-2 py-2 text-xs font-medium text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{STOREFRONT_LINK_NOT_SET}</span>
        </p>
      )}

      <div className="space-y-2 border-t border-border px-2 pt-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-fg" dir="ltr" title={identity.email}>
            {identity.email}
          </p>
          <p className="text-[11px] text-muted">{identity.role === 'owner' ? 'مالك' : 'أدمن'}</p>
        </div>
        <SignOutButton />
      </div>
    </nav>
  )

  return (
    <div className="min-h-dvh bg-bg">
      {/* Sidebar ثابتة على الديسكتوب */}
      <aside className="fixed inset-y-0 right-0 hidden w-sidebar border-s border-border bg-surface lg:block">{nav}</aside>

      {/* Drawer على الموبايل — بيطلع من اليمين، نفس ناحية زرار القائمة */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="قائمة اللوحة">
          <div className="admin-drawer-backdrop absolute inset-0 bg-fg/40" onClick={() => setOpen(false)} />
          <aside className="admin-drawer-panel absolute inset-y-0 right-0 w-72 max-w-[85vw] border-s border-border bg-surface shadow-xl">
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="lg:mr-sidebar">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label={open ? 'اقفل القائمة' : 'افتح القائمة'}
            onClick={() => setOpen((value) => !value)}
            className="relative z-50 flex h-10 w-10 items-center justify-center rounded text-fg hover:bg-border/50"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span dir="ltr" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand">
            <LogoMark size={20} letter={LOGO_LETTER} />
            ZELL
          </span>
        </header>

        <main className="px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  )
}
