'use client'

import { useEffect, useRef } from 'react'
import { UNSAVED_CHANGES_MESSAGE, shouldGuardClick } from '../../lib/inventory/navigation'

/**
 * حماية مغادرة الصفحة — مكوّن واحد مشترك (ملحق المراجعة · 5). بيتحط **مرة واحدة** في الصفحة
 * (النموذج نفسه)، والمكوّنات الفرعية مابتضيفش listeners خاصة بيها.
 *
 * وهو active (تعديلات مش محفوظة، أو عملية نتيجتها مش واضحة):
 *   1. قفل التاب / تحديث الصفحة / رابط خارجي في نفس التاب → beforeunload (تحذير المتصفح).
 *   2. رابط داخلي (Next Link أو <a>) → اعتراض الضغطة في مرحلة capture قبل ما الراوتر يشوفها،
 *      وconfirm. القرار نفسه في shouldGuardClick (lib/inventory/navigation.ts، عليه اختبارات).
 *   3. Back/Forward → مدخل history إضافي لنفس الصفحة (بنفس history.state بتاع Next عشان الراوتر
 *      يتعامل معاه كنفس الصفحة). أول Back بيستهلكه ويسأل:
 *        • خروج → history.back() للصفحة اللي قبلها فعلًا.
 *        • بقاء → المدخل بيترجع، والصفحة والتعديلات زي ما هي.
 *      السلوك الموثّق: بعد ما الحماية تتشال (حفظ ناجح) ممكن يفضل المدخل الإضافي، فأول Back بعدها
 *      بيرجع لنفس الصفحة مرة. ده آمن (مفيش كتابة ولا فقد بيانات)، وأقل من مخاطرة اعتراض الراوتر.
 */
export function UnsavedChangesGuard({ active, message = UNSAVED_CHANGES_MESSAGE }: { active: boolean; message?: string }) {
  const activeRef = useRef(active)
  const messageRef = useRef(message)
  messageRef.current = message
  /** فيه مدخل history إضافي فوق الصفحة دلوقتي؟ */
  const armedRef = useRef(false)

  // listener الـpopstate عايش طول عمر المكوّن، عشان يعرف لو المدخل الإضافي اتستهلك حتى والحماية مش active
  useEffect(() => {
    const onPopState = () => {
      if (!armedRef.current) return
      armedRef.current = false
      if (!activeRef.current) return
      if (window.confirm(messageRef.current)) {
        window.history.back()
        return
      }
      window.history.pushState(window.history.state, '', window.location.href)
      armedRef.current = true
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    activeRef.current = active
    if (!active) return

    if (!armedRef.current) {
      window.history.pushState(window.history.state, '', window.location.href)
      armedRef.current = true
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target
      const anchor = target instanceof Element ? target.closest('a') : null
      if (!anchor) return
      const guard = shouldGuardClick({
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
        target: anchor.getAttribute('target'),
        download: anchor.hasAttribute('download'),
        href: anchor.getAttribute('href'),
        currentHref: window.location.href,
      })
      if (!guard) return
      if (window.confirm(messageRef.current)) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active])

  return null
}
