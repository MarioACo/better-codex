import assert from 'node:assert/strict'
import { test } from 'node:test'
import { subtotal, total } from '../src/cart.js'

const items = [
  { name: 'Coffee', price: 120, qty: 2, category: 'general' },
  { name: 'Bread', price: 35, qty: 1, category: 'food' }
]

test('subtotal adds every line', () => assert.equal(subtotal(items), 275))
test('total adds IVA to taxable items only', () => assert.equal(total(items), 313.4))
test('a coupon lowers the total', () => assert.equal(total([{ price: 800, qty: 1, category: 'food' }], { coupon: { code: 'WELCOME50', amount: 50, minSubtotal: 500 } }), 750))
