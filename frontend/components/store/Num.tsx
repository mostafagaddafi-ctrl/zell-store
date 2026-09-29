import type { ReactNode } from 'react'

/** أي رقم أو تليفون أو رقم طلب لازم يتعرض من الشمال لليمين حتى جوه نص عربي. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`num${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  )
}
