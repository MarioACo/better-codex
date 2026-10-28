import { round, taxFor } from './tax.js'

export function subtotal(items) {
  return round(items.reduce((sum, item) => sum + item.price * item.qty, 0))
}

// A coupon is { code, amount, minSubtotal }.
export function applyCoupon(amount, coupon) {
  if (!coupon) return amount
  return round(amount - coupon.amount)
}

export function total(items, { coupon, region } = {}) {
  return round(applyCoupon(subtotal(items), coupon) + taxFor(items, { region }))
}
