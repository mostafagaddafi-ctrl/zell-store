import { useState } from 'react'
import { MoveHorizontal } from 'lucide-react'

export type GalleryItem = { before: string; after: string; caption: string }

/** معرض «قبل وبعد» — بيظهر بس لما يكون فيه صور حقيقية من شغلكم. */
export function BeforeAfter({ items }: { items: GalleryItem[] }) {
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="text-base font-bold text-foreground">شغلنا — قبل وبعد</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">صور حقيقية من بيوت عملائنا.</p>
      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <Slider key={`${item.after}-${index}`} item={item} />
        ))}
      </div>
    </section>
  )
}

function Slider({ item }: { item: GalleryItem }) {
  const [position, setPosition] = useState(50)

  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-[4/3] w-full select-none">
        <img src={item.after} alt={item.caption || 'بعد'} className="absolute inset-0 h-full w-full object-cover" />
        {item.before ? (
          <div className="absolute inset-0 overflow-hidden" style=undefined>
            <img
              src={item.before}
              alt={item.caption || 'قبل'}
              className="h-full w-full object-cover"
              style=undefined
            />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">
              قبل
            </span>
          </div>
        ) : null}
        <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">بعد</span>

        {item.before ? (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90"
              style=undefined
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#12304f] shadow-retool-md"
              style=undefined
              aria-hidden="true"
            >
              <MoveHorizontal className="h-4 w-4" />
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              aria-label="قارن قبل وبعد"
              className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
            />
          </>
        ) : null}
      </div>
      {item.caption ? (
        <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {item.caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
