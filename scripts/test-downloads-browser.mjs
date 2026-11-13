import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const previewBaseUrl = 'http://127.0.0.1:4173/doc-preview/'
try {
  await access(new URL('../dist/index.html', import.meta.url))
} catch {
  throw new Error('Built site not found. Run npm run build before npm run test:browser.')
}
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const previewServer = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  stdio: 'inherit',
})
let previewServerError
previewServer.on('error', (error) => {
  previewServerError = error
})
let browser

async function waitForPreview() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (previewServerError) throw previewServerError
    if (previewServer.exitCode !== null || previewServer.signalCode !== null) {
      throw new Error('Vite preview exited before becoming ready')
    }
    let response
    try {
      response = await fetch(previewBaseUrl)
    } catch {
      // The preview server is still starting.
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }
    if (response.status === 404) {
      throw new Error('Vite preview returned 404 for the configured base path: ' + previewBaseUrl)
    }
    if (response.ok) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite preview did not become ready within 30 seconds')
}

try {
  await waitForPreview()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const forceChunkFallback = process.argv.includes('--force-chunk-fallback')
  await page.addInitScript((disableResizableBuffers) => {
    localStorage.setItem('locale', 'en')
    if (disableResizableBuffers) {
      Object.defineProperty(ArrayBuffer.prototype, 'resize', { configurable: true, value: undefined })
    }
  }, forceChunkFallback)
  await page.goto(previewBaseUrl, { waitUntil: 'networkidle' })
  const resizableBuffersAvailable = await page.evaluate(() => (
    typeof ArrayBuffer.prototype.resize === 'function'
  ))
  assert.equal(resizableBuffersAvailable, !forceChunkFallback, 'Browser mode should match the requested buffer path')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const fileInput = page.locator('.file-input')
  assert.equal(await fileInput.evaluate((input) => input === document.activeElement), true)
  assert.notEqual(await page.locator('.upload-btn').evaluate((label) => getComputedStyle(label).outlineStyle), 'none')
  const fileChooserStarted = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await fileChooserStarted).setFiles('docs/doc-101.doc')
  await page.locator('.doc-preview .document-content').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => (
    document.querySelector('.doc-preview [role="status"]')?.textContent?.includes('doc-101.doc')
  ))

  const visibleText = await page.locator('.doc-preview .document-content').innerText()
  const contentMarker = visibleText.split(/\s+/).find((word) => word.length >= 4)
  assert.ok(contentMarker, 'The sample DOC should render readable text')

  const exports = [
    { label: 'Download as text file', extension: 'txt' },
    { label: 'Download as HTML file', extension: 'html' },
    { label: 'Download as Markdown file', extension: 'md' },
  ]

  for (const item of exports) {
    const downloadStarted = page.waitForEvent('download')
    await page.getByRole('button', { name: item.label }).click()
    const download = await downloadStarted
    assert.equal(download.suggestedFilename(), 'doc-101.' + item.extension)
    const path = await download.path()
    assert.ok(path, item.extension + ' download should complete')
    const content = await readFile(path, 'utf8')
    assert.ok(content.includes(contentMarker), item.extension + ' export should contain rendered document text')
    if (item.extension === 'html') assert.match(content, /<!DOCTYPE html>/i)
  }

  await page.locator('.back-btn').click()
  const remoteUrl = new URL('doc-101.doc?browser-smoke=1', previewBaseUrl).toString()
  const sourceDoc = await readFile('docs/doc-101.doc')
  const workerThresholdBytes = 1024 * 1024 + 1
  const sampleDoc = Buffer.concat([sourceDoc, Buffer.alloc(workerThresholdBytes - sourceDoc.byteLength)])
  await page.route((url) => url.href === remoteUrl, (route) => route.fulfill({
    status: 200,
    headers: {
      'content-type': 'application/msword',
      'content-length': String(sampleDoc.byteLength),
    },
    body: sampleDoc,
  }))
  await page.locator('.url-input').fill(remoteUrl)
  await page.locator('.url-btn').click()
  await page.locator('.doc-preview .document-content').waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForFunction(() => (
    document.querySelector('.doc-preview [role="status"]')?.textContent?.includes('doc-101.doc?browser-smoke=1')
  ), { timeout: 30_000 })
  const remoteText = await page.locator('.doc-preview .document-content').innerText()
  assert.ok(remoteText.includes(contentMarker), 'URL stream should render the source DOC content')

  const bufferMode = forceChunkFallback ? 'chunk fallback' : 'resizable buffer'
  console.log('Verified keyboard upload, >1 MiB URL/Worker parsing (' + bufferMode + '), and TXT, HTML, and Markdown downloads.')
} finally {
  try {
    await browser?.close()
  } finally {
    if (previewServer.exitCode === null && previewServer.signalCode === null) {
      const serverExited = once(previewServer, 'exit')
      previewServer.kill('SIGTERM')
      await serverExited
    }
  }
}
