import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Search, Store } from 'lucide-react'
import { OrdersTable } from '../components/admin/OrdersTable'
import { ProductsManager } from '../components/admin/ProductsManager'
import { ReadinessPanel } from '../components/admin/ReadinessPanel'
import { SettingsPanel } from '../components/admin/SettingsPanel'
import { SummaryCards } from '../components/admin/SummaryCards'
import type { ProductFormValues } from '../components/admin/ProductDialog'
import {
  useGetOrders,
  useGetReadiness,
  useGetSettings,
  useListProducts,
  useSaveProduct,
  useSaveSettings,
  useUpdateOrderStatus,
} from '../hooks/backend/admin'
import {
  ORDER_STATUSES,
  STATUS_LABELS,
  type AdminOrder,
  type AdminProduct,
  type AdminSettings,
  type OrdersSummary,
  type OrderStatus,
  type ReadinessCheck,
  type SettingsSavePayload,
} from '../lib/core/types'
import { Button } from '../lib/shadcn/button'
import { Input } from '../lib/shadcn/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../lib/shadcn/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../lib/shadcn/tabs'

type OrdersPayload = {
  orders: AdminOrder[]
  summary: OrdersSummary
  statusCounts: Record<string, number>
}

type ReadinessPayload = { checks: ReadinessCheck[]; readyCount: number; total: number }

export default function Admin() {
  const ordersQuery = useGetOrders()
  const readinessQuery = useGetReadiness()
  const productsQuery = useListProducts()
  const settingsQuery = useGetSettings()
  const updateStatus = useUpdateOrderStatus()
  const saveProduct = useSaveProduct()
  const saveSettings = useSaveSettings()

  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [productError, setProductError] = useState<string | null>(null)
  const [settingsMessage, setSettingsMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const loadOrders = () => {
    ordersQuery.trigger({ status: status === 'all' ? '' : status, search })
  }

  useEffect(() => {
    ordersQuery.trigger({ status: status === 'all' ? '' : status, search })
  }, [ordersQuery.trigger, status, search])

  useEffect(() => {
    readinessQuery.trigger()
    productsQuery.trigger()
    settingsQuery.trigger()
  }, [readinessQuery.trigger, productsQuery.trigger, settingsQuery.trigger])

  const ordersData = ordersQuery.data as OrdersPayload | null
  const readiness = readinessQuery.data as ReadinessPayload | null
  const products = (productsQuery.data as AdminProduct[] | null) ?? []
  const settings = settingsQuery.data as AdminSettings | null

  const handleStatusChange = async (orderId: number, next: OrderStatus) => {
    setUpdatingId(orderId)
    try {
      await updateStatus.trigger({ orderId, status: next }).result
      loadOrders()
      readinessQuery.trigger()
    } finally {
      setUpdatingId(null)
    }
  }

  const handleSaveProduct = async (values: ProductFormValues): Promise<boolean> => {
    setProductError(null)
    const toInt = (raw: string) => Math.round(Number(raw) || 0)
    const params = {
      id: values.id,
      name_ar: values.name_ar,
      name_en: values.name_en,
      brand: values.brand,
      description_ar: values.description_ar,
      image_url: values.image_url,
      images: values.images_text
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url !== ''),
      before_image: values.before_image,
      after_image: values.after_image,
      price_per_meter_piastres: Math.round((Number(values.price_pounds) || 0) * 100),
      width_cm: toInt(values.width_cm),
      min_length_cm: toInt(values.min_length_cm),
      step_cm: toInt(values.step_cm),
      max_length_cm: toInt(values.max_length_cm),
      is_active: values.is_active,
      sort_order: toInt(values.sort_order),
    }
    try {
      const result = (await saveProduct.trigger(params).result) as { ok: boolean; message?: string }
      if (!result.ok) {
        setProductError(result.message ?? 'تعذّر حفظ المنتج')
        return false
      }
      productsQuery.trigger()
      readinessQuery.trigger()
      return true
    } catch (err) {
      setProductError(err instanceof Error ? err.message : 'تعذّر حفظ المنتج')
      return false
    }
  }

  const handleSaveSettings = async (values: SettingsSavePayload) => {
    setSettingsMessage(null)
    try {
      const result = (await saveSettings.trigger(values).result) as { ok: boolean; message?: string }
      if (result.ok) {
        setSettingsMessage({ kind: 'ok', text: 'تم حفظ الإعدادات' })
        settingsQuery.trigger()
        readinessQuery.trigger()
      } else {
        setSettingsMessage({ kind: 'error', text: result.message ?? 'تعذّر الحفظ' })
      }
    } catch (err) {
      setSettingsMessage({ kind: 'error', text: err instanceof Error ? err.message : 'تعذّر الحفظ' })
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-3">
          <h1 className="font-semibold text-foreground">لوحة تحكم المتجر</h1>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <Store className="ml-2 h-4 w-4" />
              صفحة البيع
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-6">
        <SummaryCards summary={ordersData?.summary ?? null} />

        <ReadinessPanel
          checks={readiness?.checks ?? []}
          readyCount={readiness?.readyCount ?? 0}
          total={readiness?.total ?? 0}
          loading={readinessQuery.loading}
          onRefresh={() => readinessQuery.trigger(undefined, { skipCache: true })}
        />

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">الطلبات</TabsTrigger>
            <TabsTrigger value="products">المنتجات</TabsTrigger>
            <TabsTrigger value="settings">الإعدادات</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSearch(searchInput.trim())
                  }}
                  placeholder="ابحث برقم الطلب أو الاسم أو الموبايل"
                  className="pr-9"
                />
              </div>
              <Button variant="outline" onClick={() => setSearch(searchInput.trim())}>
                بحث
              </Button>

              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {ORDER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {`${STATUS_LABELS[s]} (${ordersData?.statusCounts[s] ?? 0})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="ghost" onClick={loadOrders} disabled={ordersQuery.loading}>
                <RefreshCw className={`ml-2 h-4 w-4${ordersQuery.loading ? ' animate-spin' : ''}`} />
                تحديث
              </Button>
            </div>

            {ordersQuery.error ? (
              <p className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {ordersQuery.error}
              </p>
            ) : null}

            <OrdersTable
              orders={ordersData?.orders ?? []}
              onStatusChange={handleStatusChange}
              updatingId={updatingId}
            />
          </TabsContent>

          <TabsContent value="products">
            <ProductsManager
              products={products}
              loading={productsQuery.loading}
              saving={saveProduct.loading}
              saveError={productError}
              onRefresh={() => productsQuery.trigger(undefined, { skipCache: true })}
              onSave={handleSaveProduct}
            />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel
              settings={settings}
              saving={saveSettings.loading}
              message={settingsMessage}
              onSave={handleSaveSettings}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
