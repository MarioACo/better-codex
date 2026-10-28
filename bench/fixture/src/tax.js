// Sales tax (IVA). Basic food, medicine and books are exempt.
export const RATES = { general: 0.16, border: 0.08, exempt: 0 }
const EXEMPT = new Set(['food', 'medicine', 'books'])

export const round = n => Math.round(n * 100) / 100

export function rateFor(item, { region = 'general' } = {}) {
  if (EXEMPT.has(item.category)) return RATES.exempt
  return region === 'border' ? RATES.border : RATES.general
}

export function taxFor(items, options) {
  return round(items.reduce((sum, item) => sum + item.price * item.qty * rateFor(item, options), 0))
}
