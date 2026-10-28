// 测试点: TP-001
// 视角: charter:numbers-copy
// 创建订单 → 订单列表包含该订单且状态正确(mock 后端黄金路径的 API 段)
import { test } from 'node:test'
import assert from 'node:assert/strict'

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080'

test('创建订单后订单列表包含该订单', async () => {
  const created = await fetch(`${baseUrl}/api/orders`, { method: 'POST' })
  assert.equal(created.status, 200)
  const { id } = await created.json()
  assert.match(id, /^\d+$/)

  const listed = await fetch(`${baseUrl}/api/orders`)
  assert.equal(listed.status, 200)
  const { orders } = await listed.json()
  const found = orders.find((order) => order.id === id)
  assert.ok(found, `订单 ${id} 应出现在列表中`)
  assert.equal(found.status, '已创建')
})
