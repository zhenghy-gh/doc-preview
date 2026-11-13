import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = resolve('dist')
const vueBundle = await readFile('node_modules/vue/dist/vue.global.prod.js', 'utf8')
const sampleDoc = (await readFile('docs/doc-101.doc')).toString('base64')
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <script src="/vue.global.js"></script>
  <script src="/doc-preview.umd.cjs"></script>
  <script>
    const bytes = Uint8Array.from(atob("${sampleDoc}"), (char) => char.charCodeAt(0))
    window.parseResult = window.DocPreview.parseWithWorker(bytes.buffer).then(
      (result) => { window.result = result; document.body.dataset.done = 'true' },
      (error) => { window.error = String(error); document.body.dataset.done = 'true' },
    )
  </script>
</body></html>`
const requests = []
const workerAssetPattern = /^\/assets\/docParser\.worker-.*\.js$/
let workerAssetStatus
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  requests.push(pathname)
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
    return
  }
  if (pathname === '/vue.global.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(vueBundle)
    return
  }
  const filePath = resolve(root, '.' + pathname)
  if (!filePath.startsWith(root + sep)) {
    response.writeHead(403).end()
    return
  }
  try {
    const contents = await readFile(filePath)
    const contentType = extname(filePath) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream'
    response.writeHead(200, { 'content-type': contentType })
    response.end(contents)
    if (workerAssetPattern.test(pathname)) workerAssetStatus = 200
  } catch {
    if (workerAssetPattern.test(pathname)) workerAssetStatus = 404
    response.writeHead(404).end()
  }
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('requestfailed', (request) => errors.push(request.url() + ': ' + request.failure()?.errorText))
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' })
  await page.waitForFunction(() => document.body.dataset.done === 'true', { timeout: 15_000 })
  const result = await page.evaluate(() => window.result)
  assert.deepEqual(errors, [])
  assert.equal(result.success, true)
  assert.ok(result.text.length > 0)
  const workerRequest = requests.find((pathname) => workerAssetPattern.test(pathname))
  assert.ok(workerRequest, 'UMD consumer should request its emitted Worker chunk')
  assert.equal(workerAssetStatus, 200, 'UMD Worker chunk should be served successfully')
  console.log('Verified UMD Worker chunk: ' + workerRequest)
} finally {
  try {
    await browser?.close()
  } finally {
    const serverClosed = once(server, 'close')
    server.close()
    await serverClosed
  }
}
