'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ExternalLink,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { SignOutButton } from './SignOutButton'

type Item = { href: string; label: string; icon: typeof Package; badge?: number }
type Group = { title?: string; items: Item[] }

export type AdminShellIdentity = { email: string; role: 'owner' | 'admin' }

export function AdminShell({
  children,
  newOrders,
  identity,
}: {
  children: ReactNode
  newOrders: number
  identity: AdminShellIdentity
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const groups: Group[] = [
    { items: [{ href: '/', label: 'نظرة عامة', icon: LayoutDashboard }] },
    { title: 'التشغيل', items: [{ href: '/orders', label: 'الطلبات', icon: ShoppingCart, badge: newOrders }] },
    { title: 'الكتالوج', items: [{ href: '/products', label: 'المنتجات', icon: Package }] },
    {
      title: 'المتجر',
      items: [
        { href: '/content', label: 'المحتوى', icon: ImageIcon },
        { href: '/shipping', label: 'الشحن', icon: Truck },
        { href: '/identity', label: 'الهوية', icon: Store },
      ],
    },
    { title: 'النظام', items: [{ href: '/settings', label: 'الإعدادات', icon: Settings }] },
  ]

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  const nav = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      <div className="px-2 pt-1">
        <p className="text-sm font-extrabold text-brand">ZELL</p>
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
                'flex items-center gap-2.5 rounded px-2 py-2 text-sm font-medium transition-colors',
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

      <a
        href="https://zell-store-nine.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto flex items-center gap-2 rounded px-2 py-2 text-xs font-medium text-muted transition-colors hover:text-accent"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        معاينة المتجر
      </a>

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

      {/* Drawer على الموبايل */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-fg/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-64 border-s border-border bg-surface">{nav}</aside>
        </div>
      ) : null}

      <div className="lg:mr-sidebar">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label={open ? 'اقفل القائمة' : 'افتح القائمة'}
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded text-fg hover:bg-border/50"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-sm font-bold text-brand">ZELL</span>
        </header>

        <main className="px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  )
}
