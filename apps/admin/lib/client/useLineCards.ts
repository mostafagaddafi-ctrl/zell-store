'use client'

import { useState } from 'react'
import { keysOpenAfterCloseAll } from '../inventory/lineIssues'

/**
 * حالة فتح/قفل كروت البنود. البند الجديد بيتفتح (openKeys)، والبنود اللي فيها مشكلة ظاهرة بتتفتح عند
 * فشل الحفظ/المعاينة، و«قفل الكل» مابيقفلش بند فيه مشكلة ظاهرة (keysOpenAfterCloseAll).
 */
export function useLineCards(initialOpen: readonly string[] = []) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initialOpen))

  return {
    isOpen: (key: string) => open.has(key),
    toggle: (key: string) =>
      setOpen((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    openKeys: (keys: Iterable<string>) => setOpen((current) => new Set([...current, ...keys])),
    closeAll: (issueKeys: Iterable<string>) => setOpen(new Set(keysOpenAfterCloseAll(issueKeys))),
  }
}
