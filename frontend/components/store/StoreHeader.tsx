import { LayoutDashboard, ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../lib/shadcn/button'
import zellLogo from '../../assets/zell-logo.jpg'

/** هيدر خفيف: لوجو ZELL + زرار السلة. */
export function StoreHeader({
  storeName,
  logoUrl,
  cartCount,
  onCartClick,
}: {
  storeName: string
  logoUrl: string
  cartCount: number
  onCartClick: () => void
}) {
  const name = storeName || 'ZELL'

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2">
          {/* اللوجو على خلفية بيضا عشان يفضل واضح في الوضع الفاتح والداكن */}
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
            <img src={logoUrl || zellLogo} alt={name} className="h-10 w-10 object-cover" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-extrabold tracking-wide text-foreground">{name}</span>
            <span className="text-[11px] text-muted-foreground">أفلام زجاج للبيوت</span>
          </span>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="لوحة التحكم">
            <Link to="/admin">
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            </Link>
          </Button>
        </div>

        <Button variant="outline" onClick={onCartClick} className="relative h-10 rounded-full px-4">
          <ShoppingCart className="ml-2 h-4 w-4" />
          السلة
          {cartCount > 0 ? (
            <span className="absolute -top-1.5 -left-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
              {cartCount}
            </span>
          ) : null}
        </Button>
      </div>
    </header>
  )
}
