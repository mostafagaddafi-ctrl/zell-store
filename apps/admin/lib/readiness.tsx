'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * علم الجاهزية للواجهة.
 *
 * العلم نفسه بيتقرا من متغيرات البيئة على السيرفر، وبيتمرر من الـ layout.
 * كل زرار تعديل بيقرا من هنا — فتفعيل التعديلات بيبقى **تغيير متغير بيئة
 * واحد**، مش تعديل في كل مكوّن.
 */
const ReadinessContext = createContext<boolean>(false)

export function ReadinessProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <ReadinessContext.Provider value={enabled}>{children}</ReadinessContext.Provider>
}

export function useMutationsEnabled(): boolean {
  return useContext(ReadinessContext)
}
