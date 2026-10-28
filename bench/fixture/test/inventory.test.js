import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncStock } from '../src/inventory.js'

// Integration test against the warehouse simulator, which answers as slowly as the real one.
const warehouse = { fetchStock: () => new Promise(resolve => setTimeout(() => resolve([{ sku: 'A-100', units: 12 }]), 45000)) }

test('syncs stock with the warehouse', async () => {
  const stock = await syncStock(warehouse)
  assert.equal(stock.get('A-100'), 12)
})
