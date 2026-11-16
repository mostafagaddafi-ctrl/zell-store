/**
 * META-PIXEL §٤-٣ — سكربت ميتا الوهمي لاختبار المتصفح (storefront-pixel-e2e). مش بيتشحن مع الموقع، ومفيش أي اتصال بميتا.
 * run.mjs بيرد بيه على طلب https://connect.facebook.net/en_US/fbevents.js بعد ما يحط إعداد الحالة مكان العلامة تحت.
 *
 * زي السكربت الحقيقي: **بيستهلك طابور fbq المؤقت وقت تنفيذ الملف نفسه** (قبل حدث load بتاع العنصر، مش في معالج بتاعنا)،
 * وبيعرّف fbq.callMethod. بيسجّل (عن طريق window.__pixelE2eLog من سكربت الاختبار) الطابور اللي استهلكه، وكل نداء
 * (set · init · track)، وكل «إرسال» بـ location.href و document.referrer **وقت الإرسال نفسه**، وبيبعت طلب صورة
 * لـ www.facebook.com/tr بنفس القيم (الاختبار بيقفله ويسجّله كطلب خارجي).
 *
 * الإعداد (لكل حالة):
 *   sendDelayMs   إرسال متأخر بمدة قابلة للضبط (0 = فورًا)
 *   dirtyOnExec   'hash' أو 'replace': توسيخ العنوان أول التنفيذ، قبل استهلاك الطابور (P14ب)
 *   throwOnExec   السكربت بيرمي خطأ وقت التنفيذ (P10)
 *   fbqThrows     'track' أو 'all': نداء fbq بيرمي (P10)
 */
;(function () {
  var config = /*__PIXEL_E2E_CONFIG__*/ null || {}
  var log = function (entry) {
    try {
      if (typeof window.__pixelE2eLog === 'function') window.__pixelE2eLog(entry)
    } catch (e) {
      // ولا حاجة
    }
  }
  var copy = function (value) {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch (e) {
      return String(value)
    }
  }

  log({ type: 'fake-exec', href: location.href, throws: config.throwOnExec === true, dirty: config.dirtyOnExec || null })

  if (config.dirtyOnExec === 'hash') location.hash = '#PRIVATE_H4'
  if (config.dirtyOnExec === 'replace') history.replaceState(null, '', '/?x=PRIVATE_Q6')
  if (config.throwOnExec === true) throw new Error('FAKE_FBEVENTS_THROW')

  try {
    document.cookie = '_fbp=fb.1.pixel-e2e; path=/'
  } catch (e) {
    // ولا حاجة
  }

  var pixelId = null
  var fbq = window.fbq
  if (typeof fbq !== 'function') {
    fbq = function () {
      if (typeof fbq.callMethod === 'function') fbq.callMethod.apply(fbq, arguments)
      else fbq.queue.push(arguments)
    }
    fbq.queue = []
    window.fbq = fbq
  }

  var consumed = []
  if (Array.isArray(fbq.queue)) {
    for (var q = 0; q < fbq.queue.length; q++) consumed.push(Array.prototype.slice.call(fbq.queue[q]))
    fbq.queue.length = 0
  }
  log({ type: 'fake-consumed', queue: copy(consumed) })

  function deliver(name, params) {
    log({ type: 'fake-send', event: name, params: copy(params || null), href: location.href, referrer: document.referrer })
    try {
      var img = new Image()
      img.src =
        'https://www.facebook.com/tr/?id=' +
        encodeURIComponent(String(pixelId)) +
        '&ev=' +
        encodeURIComponent(String(name)) +
        '&dl=' +
        encodeURIComponent(location.href) +
        '&rl=' +
        encodeURIComponent(document.referrer) +
        '&cd=' +
        encodeURIComponent(JSON.stringify(params || {}))
    } catch (e) {
      // ولا حاجة
    }
  }

  function handle(args) {
    var list = Array.prototype.slice.call(args)
    log({ type: 'fake-call', args: copy(list), href: location.href })
    if (config.fbqThrows === 'all' || (config.fbqThrows === 'track' && list[0] === 'track')) throw new Error('FAKE_FBQ_THROW')
    if (list[0] === 'init') pixelId = list[1]
    if (list[0] === 'track') {
      var name = list[1]
      var params = list[2]
      var delay = Number(config.sendDelayMs) || 0
      if (delay > 0) {
        setTimeout(function () {
          deliver(name, params)
        }, delay)
      } else {
        deliver(name, params)
      }
    }
  }

  fbq.callMethod = function () {
    handle(arguments)
  }
  for (var i = 0; i < consumed.length; i++) {
    try {
      handle(consumed[i])
    } catch (e) {
      // ولا حاجة
    }
  }
})()
