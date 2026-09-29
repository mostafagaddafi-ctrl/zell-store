export type MaterialPhoto = { image: string; caption: string }

/** شريط «خامات أصلية» — صور الرولات والكراتين من المخزن. بيظهر بس لما تترفع صور. */
export function MaterialsStrip({ items }: { items: MaterialPhoto[] }) {
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="text-lg font-bold text-foreground">خامات أصلية</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">البضاعة اللي بنقص منها — من مخزننا.</p>

      <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {items.map((item, index) => (
          <figure
            key={`${item.image}-${index}`}
            className="w-40 shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card"
          >
            <img
              src={item.image}
              alt={item.caption || 'خامة أصلية'}
              loading="lazy"
              className="h-32 w-full object-cover"
            />
            {item.caption ? (
              <figcaption className="px-2 py-2 text-center text-xs text-muted-foreground">{item.caption}</figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </section>
  )
}
