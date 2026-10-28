// Pulls stock levels from the warehouse service.
export async function syncStock(warehouse) {
  const rows = await warehouse.fetchStock()
  return new Map(rows.map(row => [row.sku, row.units]))
}
