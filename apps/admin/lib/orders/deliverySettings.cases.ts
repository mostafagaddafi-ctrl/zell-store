/**
 * 0021-D2 W2 — حالات كارت «موعد التسليم في صفحة الطلب» (منطق خالص — pnpm --filter @zell/admin cases).
 */

import {
  DEFAULT_DELIVERY_NOTE,
  DELIVERY_FIELD_MESSAGES,
  DELIVERY_NOTE_MAX,
  DELIVERY_SETTINGS_TEXT,
  deliveryPreview,
  deliverySettingsFailureKind,
  deliverySettingsIssue,
  formOf,
  inputOf,
  normalizeDeliveryNote,
  parseDeliverySettings,
  type DeliverySettings,
} from './deliverySettings'

export type DeliveryCaseFailure = { name: string; expected: string; actual: string }

const failures: DeliveryCaseFailure[] = []
let passed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed += 1
  else failures.push({ name, expected: e, actual: a })
}

const AT = '2026-10-12T18:00:00.123456+00:00'
const FRESH: DeliverySettings = { customerChoiceEnabled: true, noteEnabled: false, noteText: null, updatedAt: AT }
const SAVED: DeliverySettings = { customerChoiceEnabled: false, noteEnabled: true, noteText: 'التوصيل عادة خلال 3 إلى 5 أيام', updatedAt: AT }

export function runDeliverySettingsCases(): { passed: number; failures: DeliveryCaseFailure[] } {
  // parse
  check('S01 parse the get reply', parseDeliverySettings({ customer_choice_enabled: true, note_enabled: false, note_text: null, updated_at: AT }), FRESH)
  check('S02 parse the save reply (extra changed key ignored)', parseDeliverySettings({ customer_choice_enabled: false, note_enabled: true, note_text: SAVED.noteText, updated_at: AT, changed: true }), SAVED)
  check('S03 bad shapes = null', [
    parseDeliverySettings(null),
    parseDeliverySettings({ customer_choice_enabled: 'yes', note_enabled: false, note_text: null, updated_at: AT }),
    parseDeliverySettings({ customer_choice_enabled: true, note_enabled: false, note_text: 3, updated_at: AT }),
    parseDeliverySettings({ customer_choice_enabled: true, note_enabled: false, note_text: null }),
  ], [null, null, null, null])

  // الفورم والنص الافتراضي (مش بيتحفظ غير بالضغط)
  check('S10 no saved text: the box starts with the real default text, settings unchanged', [formOf(FRESH), FRESH.noteText], [
    { customerChoiceEnabled: true, noteEnabled: false, noteText: DEFAULT_DELIVERY_NOTE },
    null,
  ])
  check('S11 saved text: the box starts with it', formOf(SAVED).noteText, SAVED.noteText)
  check('S12 the save input is built from the form + the row version only (on «حفظ»)', inputOf(formOf(FRESH), FRESH), {
    expectedUpdatedAt: AT,
    customerChoiceEnabled: true,
    noteEnabled: false,
    noteText: DEFAULT_DELIVERY_NOTE,
  })

  // التحقق = قواعد الداتابيز
  check('S20 note on + empty (spaces, newlines) -> note_text message', [
    deliverySettingsIssue({ customerChoiceEnabled: true, noteEnabled: true, noteText: '   ' }),
    deliverySettingsIssue({ customerChoiceEnabled: true, noteEnabled: true, noteText: ' \n\t ' }),
  ], [DELIVERY_FIELD_MESSAGES['note_text'], DELIVERY_FIELD_MESSAGES['note_text']])
  check('S21 longer than 300 after trim -> refused even with the note off', deliverySettingsIssue({ customerChoiceEnabled: true, noteEnabled: false, noteText: 'x'.repeat(DELIVERY_NOTE_MAX + 1) }), DELIVERY_FIELD_MESSAGES['note_text'])
  check('S22 exactly 300 Arabic characters + spaces around -> ok', deliverySettingsIssue({ customerChoiceEnabled: false, noteEnabled: true, noteText: '  ' + 'م'.repeat(DELIVERY_NOTE_MAX) + '  ' }), null)
  check('S23 note off + empty -> ok (stored NULL)', [deliverySettingsIssue({ customerChoiceEnabled: true, noteEnabled: false, noteText: '' }), normalizeDeliveryNote('  ')], [null, null])
  check('S24 normalize = trim spaces / tabs / newlines only', normalizeDeliveryNote(' \n هنكلمك \t'), 'هنكلمك')

  // المعاينة
  check('S30 preview: choice off + note on', deliveryPreview({ customerChoiceEnabled: false, noteEnabled: true, noteText: '  سطر  ' }), {
    choice: DELIVERY_SETTINGS_TEXT.previewChoiceOff,
    note: 'سطر',
  })
  check('S31 preview: choice on + note off', deliveryPreview({ customerChoiceEnabled: true, noteEnabled: false, noteText: 'مخفي' }), {
    choice: DELIVERY_SETTINGS_TEXT.previewChoiceOn,
    note: null,
  })

  // الأخطاء من الداتابيز
  check('S40 45430 with the field', [
    deliverySettingsFailureKind({ code: '45430', message: 'ZELL_DELIVERY_SETTINGS_INVALID', details: 'note_text' }, 400),
    deliverySettingsFailureKind({ code: '45430', message: 'ZELL_DELIVERY_SETTINGS_INVALID', details: 'customer_choice_enabled' }, 400),
    deliverySettingsFailureKind({ code: '45430', message: 'ZELL_DELIVERY_SETTINGS_INVALID', details: null }, 400),
  ], [
    { kind: 'validation', message: DELIVERY_FIELD_MESSAGES['note_text'] },
    { kind: 'validation', message: DELIVERY_FIELD_MESSAGES['customer_choice_enabled'] },
    { kind: 'validation', message: DELIVERY_FIELD_MESSAGES['note_text'] },
  ])
  check('S41 identity and version from the order cycle', [
    deliverySettingsFailureKind({ code: '45400', message: 'ZELL_ORD_UNAUTHENTICATED' }, 400).kind,
    deliverySettingsFailureKind({ code: '45401', message: 'ZELL_ORD_FORBIDDEN' }, 400).kind,
    deliverySettingsFailureKind({ code: '45402', message: 'ZELL_ORD_OWNER_ONLY' }, 400).kind,
    deliverySettingsFailureKind({ code: '45404', message: 'ZELL_ORD_CONFLICT' }, 400).kind,
    deliverySettingsFailureKind({ code: 'XX000', message: 'boom' }, 500).kind,
  ], ['unauthenticated', 'forbidden', 'validation', 'conflict', 'internal'])

  return { passed, failures }
}
