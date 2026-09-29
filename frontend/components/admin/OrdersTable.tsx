import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown, BellOff, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { formatLength, formatPiastres } from '../../lib/core/pricing'
import { ORDER_STATUSES, STATUS_LABELS, type AdminOrder, type OrderStatus } from '../../lib/core/types'
import { Button } from '../../lib/shadcn/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../lib/shadcn/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../lib/shadcn/table'
import { Num } from '../store/Num'

type OrdersTableProps = {
  orders: AdminOrder[]
  onStatusChange: (orderId: number, status: OrderStatus) => void
  updatingId: number | null
}

export function OrdersTable({ orders, onStatusChange, updatingId }: OrdersTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created_at', desc: true }])

  const columns = useMemo<ColumnDef<AdminOrder>[]>(
    () => [
      {
        accessorKey: 'order_number',
        header: 'رقم الطلب',
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold">
            <Num>{row.original.order_number}</Num>
          </span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'التاريخ',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            <Num>
              {new Date(row.original.created_at).toLocaleString('ar-EG-u-nu-latn', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </Num>
          </span>
        ),
      },
      {
        id: 'customer',
        accessorFn: (row) => row.customer_name,
        header: 'العميل',
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.customer_name}</div>
            <div className="text-xs text-muted-foreground">
              <Num>{row.original.customer_phone}</Num>
            </div>
          </div>
        ),
      },
      {
        id: 'product',
        accessorFn: (row) => row.items[0]?.product_name_ar ?? '',
        header: 'الأصناف',
        cell: ({ row }) => {
          const items = row.original.items ?? []
          const first = items[0]
          return (
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {first?.product_image_url ? (
                  <img
                    src={first.product_image_url}
                    alt={first.product_name_ar}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm text-foreground">
                  {first ? first.product_name_ar : '—'}
                  {items.length > 1 ? (
                    <span className="text-xs text-muted-foreground"> +{items.length - 1} صنف</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {first ? `${formatLength(first.length_cm)} × ${first.width_cm} سم` : null}
                </div>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'governorate',
        header: 'المحافظة',
        cell: ({ row }) => <span className="text-sm">{row.original.governorate}</span>,
      },
      {
        accessorKey: 'total_piastres',
        header: 'الإجمالي',
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold">{formatPiastres(row.original.total_piastres)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'الحالة',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Select
              value={row.original.status}
              onValueChange={(value) => onStatusChange(row.original.id, value as OrderStatus)}
              disabled={updatingId === row.original.id}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!row.original.notified_at && row.original.notify_error ? (
              <span title={row.original.notify_error} className="text-warning">
                <BellOff className="h-4 w-4" />
              </span>
            ) : null}
          </div>
        ),
        enableSorting: false,
      },
    ],
    [onStatusChange, updatingId],
  )

  const table = useReactTable({
    data: orders ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  })

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-right">
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">
                  مفيش طلبات مطابقة
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-right">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          صفحة {table.getState().pagination.pageIndex + 1} من {Math.max(table.getPageCount(), 1)} · {orders.length} طلب
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
