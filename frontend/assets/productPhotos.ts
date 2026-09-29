/**
 * صور المنتجات المدمجة في التطبيق (جزء من الريبو — مش روابط خارجية).
 * ترتيب كل مجموعة: البريفيو (شكله راكب على الشباك) الأول، وبعده صور الرول.
 * لو المنتج له صور متسجّلة في الداتابيز، هي اللي بتتقدّم على دول.
 */
import heatPreview from './products/heat-preview.jpg'
import heat1 from './products/heat-1.jpg'
import heat2 from './products/heat-2.jpg'
import heat3 from './products/heat-3.jpg'
import heat4 from './products/heat-4.jpg'

import smokedPreview from './products/smoked-preview.jpg'
import smoked1 from './products/smoked-1.jpg'
import smoked2 from './products/smoked-2.jpg'
import smoked3 from './products/smoked-3.jpg'
import smoked4 from './products/smoked-4.jpg'

import frostedPreview from './products/frosted-preview.jpg'
import frosted1 from './products/frosted-1.jpg'
import frosted2 from './products/frosted-2.jpg'
import frosted3 from './products/frosted-3.jpg'
import frosted4 from './products/frosted-4.jpg'

const HEAT = [heatPreview, heat1, heat2, heat3, heat4]
const SMOKED = [smokedPreview, smoked1, smoked2, smoked3, smoked4]
const FROSTED = [frostedPreview, frosted1, frosted2, frosted3, frosted4]

/** يختار مجموعة الصور المناسبة من اسم المنتج. */
export function localProductPhotos(nameAr: string, nameEn: string | null): string[] {
  const text = `${nameAr} ${nameEn ?? ''}`.toLowerCase()

  if (text.includes('مصنفر') || text.includes('مطفي') || text.includes('frost')) return FROSTED
  if (text.includes('فاميه') || text.includes('أسود') || text.includes('smoke') || text.includes('blackout')) {
    return SMOKED
  }
  if (text.includes('عازل') || text.includes('حرار') || text.includes('شمس') || text.includes('heat')) return HEAT

  // احتياطي حسب الوظيفة
  if (text.includes('خصوصي') || text.includes('privacy')) return FROSTED
  return []
}
