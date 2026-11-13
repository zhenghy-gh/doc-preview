import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = resolve('dist')
const vueGlobalBundle = await readFile('node_modules/vue/dist/vue.global.prod.js', 'utf8')
const vueEsmBundle = await readFile('node_modules/vue/dist/vue.esm-browser.prod.js', 'utf8')
const sampleDoc = (await readFile('docs/doc-101.doc')).toString('base64')
const umdHtml = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<script src="/vue.global.js"></script><script src="/doc-preview.umd.cjs"></script>',
  '<script>const bytes=Uint8Array.from(atob("' + sampleDoc + '"),c=>c.charCodeAt(0));',
  'window.parseResult=window.DocPreview.parseWithWorker(bytes.buffer).then(',
  '(result)=>{window.result=result;document.body.dataset.done="true"},',
  '(error)=>{window.error=String(error);document.body.dataset.done="true"})</script>',
  '</body></html>',
].join('')
const esmHtml = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<script type="importmap">{"imports":{"vue":"/vue.esm-browser.js"}}</script>',
  '</head><body><script type="module">',
  'import { parseWithWorker } from "/doc-preview.js";',
  'const bytes=Uint8Array.from(atob("' + sampleDoc + '"),c=>c.charCodeAt(0));',
  'window.parseResult=parseWithWorker(bytes.buffer).then(',
  '(result)=>{window.result=result;document.body.dataset.done="true"},',
  '(error)=>{window.error=String(error);document.body.dataset.done="true"})',
  '</script></body></html>',
].join('')
const requests = []
const workerAssetPattern = /^\/assets\/docParser\.worker-.*\.js$/
const workerAssetStatuses = new Map()
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  requests.push(pathname)
  const pages = { '/umd': umdHtml, '/esm': esmHtml }
  if (pages[pathname]) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(pages[pathname])
    return
  }
  if (pathname === '/vue.global.js' || pathname === '/vue.esm-browser.js') {
    const bundle = pathname === '/vue.global.js' ? vueGlobalBundle : vueEsmBundle
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(bundle)
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
    if (workerAssetPattern.test(pathname)) workerAssetStatuses.set(pathname, 200)
  } catch {
    if (workerAssetPattern.test(pathname)) workerAssetStatuses.set(pathname, 404)
    response.writeHead(404).end()
  }
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const origin = 'http://127.0.0.1:' + server.address().port
  async function verifyEntry(pathname, label) {
    const page = await browser.newPage()
    const errors = []
    const requestStart = requests.length
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('requestfailed', (request) => errors.push(request.url() + ': ' + request.failure()?.errorText))
    try {
      await page.goto(origin + pathname, { waitUntil: 'load' })
      await page.waitForFunction(() => document.body.dataset.done === 'true', { timeout: 15_000 })
      const result = await page.evaluate(() => window.result)
      assert.deepEqual(errors, [], label + ' should not report browser errors')
      assert.equal(result.success, true, label + ' should parse the sample DOC')
      assert.ok(result.text.length > 0, label + ' should return parsed text')
      const workerRequest = requests.slice(requestStart).find((url) => workerAssetPattern.test(url))
      assert.ok(workerRequest, label + ' should request the emitted Worker chunk')
      assert.equal(workerAssetStatuses.get(workerRequest), 200, label + ' Worker chunk should be served successfully')
      console.log('Verified ' + label + ' Worker chunk: ' + workerRequest)
    } finally {
      await page.close()
    }
  }
  await verifyEntry('/umd', 'UMD')
  await verifyEntry('/esm', 'ESM')
} finally {
  try {
    await browser?.close()
  } finally {
    const serverClosed = once(server, 'close')
    server.close()
    await serverClosed
  }
}
