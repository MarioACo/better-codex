const SYMBOLS = { MXN: '$' }

export function formatPrice(amount, { currency = 'MXN' } = {}) {
  return `${SYMBOLS[currency]}${amount.toFixed(2)}`
}

export const formatLine = item => `${item.qty} x ${item.name}  ${formatPrice(item.price * item.qty)}`
