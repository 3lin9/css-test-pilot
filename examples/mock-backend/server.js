// TestPilot 跨端黄金路径演示用的 mock 业务后端(零依赖)
// 启动:node examples/mock-backend/server.js   (PORT 环境变量可改端口,默认 8080)
// 接口:
//   POST /api/orders  创建订单 -> { id }
//   GET  /api/orders  订单列表 -> { orders: [{ id, status, time }] }
//   GET  /orders      订单后台页面(Web 端 assert 目标)
import http from 'node:http'

const port = Number(process.env.PORT) || 8080
const orders = []
let nextId = 1001

function pageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>订单后台</title></head>
<body>
<h1>订单后台</h1>
<table class="order-list"><tbody id="orders"></tbody></table>
<script>
  fetch('/api/orders').then((r) => r.json()).then(({ orders }) => {
    document.getElementById('orders').innerHTML = orders
      .map((o) => '<tr class="order-row order-row-' + o.id + '"><td>' + o.id + '</td><td>' + o.status + '</td></tr>')
      .join('')
  })
</script>
</body>
</html>`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const order = { id: String(nextId++), status: '已创建', time: new Date().toISOString() }
    orders.unshift(order)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: order.id }))
    return
  }

  if (url.pathname === '/api/orders') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ orders }))
    return
  }

  if (url.pathname === '/' || url.pathname === '/orders') {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(pageHtml())
    return
  }

  res.statusCode = 404
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock backend listening at http://127.0.0.1:${port}`)
})
