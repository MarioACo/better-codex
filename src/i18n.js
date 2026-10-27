// Language of the messages shown to you. The model always gets English: shorter and followed best.
export function resolveLang(setting = 'auto') {
  if (setting === 'es' || setting === 'en') return setting
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  const locale = (process.platform === 'win32' ? '' : env) || Intl.DateTimeFormat().resolvedOptions().locale || env
  return /^es/i.test(locale) ? 'es' : 'en'
}

export const pick = (lang, es, en) => (lang === 'es' ? es : en)

export const localeOf = lang => (lang === 'es' ? 'es-MX' : 'en-US')

export function humanNumber(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`
  return String(Math.round(n))
}

export function windowLabel(minutes, lang) {
  if (!minutes) return pick(lang, 'límite', 'limit')
  if (minutes === 10080) return pick(lang, 'semana', 'week')
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} d`
}

export function whenLabel(ms, lang) {
  if (!ms) return ''
  const date = new Date(ms)
  const soon = ms - Date.now() < 20 * 60 * 60 * 1000
  return new Intl.DateTimeFormat(localeOf(lang), soon ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
