/** قراءة كل الإعدادات لعرضها في لوحة التحكم. */
import { loadSettings, settingNumber, settingRecord, settingString } from '../lib/db'

export type Testimonial = { name: string; area: string; text: string }
export type GalleryItem = { before: string; after: string; caption: string }
export type MaterialPhoto = { image: string; caption: string }

export type AdminSettings = {
  store_name: string
  logo_url: string
  offer_text: string
  whatsapp_number: string
  whatsapp_message: string
  notify_email: string
  telegram_bot_token: string
  telegram_chat_id: string
  shipping_default_piastres: number
  free_shipping_threshold_piastres: number
  shipping_rates: Record<string, number>
  testimonials: Testimonial[]
  gallery: GalleryItem[]
  materials: MaterialPhoto[]
}

export default async function (): Promise<AdminSettings> {
  const settings = await loadSettings()
  return {
    store_name: settingString(settings, 'store_name'),
    logo_url: settingString(settings, 'logo_url'),
    offer_text: settingString(settings, 'offer_text'),
    whatsapp_number: settingString(settings, 'whatsapp_number'),
    whatsapp_message: settingString(settings, 'whatsapp_message'),
    notify_email: settingString(settings, 'notify_email'),
    telegram_bot_token: settingString(settings, 'telegram_bot_token'),
    telegram_chat_id: settingString(settings, 'telegram_chat_id'),
    shipping_default_piastres: settingNumber(settings, 'shipping_default_piastres', 0),
    free_shipping_threshold_piastres: settingNumber(settings, 'free_shipping_threshold_piastres', 0),
    shipping_rates: settingRecord(settings, 'shipping_rates'),
    testimonials: Array.isArray(settings['testimonials']) ? (settings['testimonials'] as Testimonial[]) : [],
    gallery: Array.isArray(settings['gallery']) ? (settings['gallery'] as GalleryItem[]) : [],
    materials: Array.isArray(settings['materials']) ? (settings['materials'] as MaterialPhoto[]) : [],
  }
}
