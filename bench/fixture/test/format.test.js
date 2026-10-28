import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatLine, formatPrice } from '../src/format.js'

test('prices in pesos', () => assert.equal(formatPrice(1234.5), '$1234.50'))
test('receipt line', () => assert.equal(formatLine({ name: 'Coffee', price: 120, qty: 2 }), '2 x Coffee  $240.00'))
