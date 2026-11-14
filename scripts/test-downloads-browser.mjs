import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'

const previewBaseUrl = 'http://127.0.0.1:4173/doc-preview/'
const browserName = process.argv.find((argument) => argument.startsWith('--browser='))?.slice('--browser='.length) ?? 'chromium'
const browserTypes = { chromium, firefox, webkit }
const browserType = browserTypes[browserName]
if (!browserType) throw new Error('Unsupported browser: ' + browserName)
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
let previewServerClosed = false
previewServer.on('error', (error) => {
  previewServerError = error
})
previewServer.on('close', () => {
  previewServerClosed = true
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

async function forceNoHasFallback(page) {
  return page.evaluate(() => {
    const fallbackRules = []
    const collectFallbackRules = (rules) => {
      for (const rule of rules) {
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes('not selector(:has(*))')) {
          fallbackRules.push(...Array.from(rule.cssRules, (nestedRule) => nestedRule.cssText))
        } else if (rule.cssRules) {
          collectFallbackRules(rule.cssRules)
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        collectFallbackRules(sheet.cssRules)
      } catch {
        // Ignore stylesheets the browser does not expose to this page.
      }
    }
    if (fallbackRules.length === 0) return 0
    const style = document.createElement('style')
    style.textContent = fallbackRules.join('\n')
    document.head.append(style)
    return fallbackRules.length
  })
}

try {
  await waitForPreview()
  browser = await browserType.launch({ headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const forceChunkFallback = process.argv.includes('--force-chunk-fallback')
  const forceNoHas = process.argv.includes('--force-no-has')
  await page.addInitScript((disableResizableBuffers) => {
    localStorage.setItem('locale', 'en')
    if (disableResizableBuffers) {
      Object.defineProperty(ArrayBuffer.prototype, 'resize', { configurable: true, value: undefined })
    }
  }, forceChunkFallback)
  await page.goto(previewBaseUrl, { waitUntil: 'networkidle' })
  assert.equal(await page.title(), 'DOC File Online Preview')
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.title === 'DOC文件在线预览' && document.documentElement.lang === 'zh-CN')
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.title === 'DOC File Online Preview' && document.documentElement.lang === 'en')
  assert.equal(await page.locator('meta[name="text-scale"]').getAttribute('content'), 'scale')
  const resizableBuffersAvailable = await page.evaluate(() => (
    typeof ArrayBuffer.prototype.resize === 'function'
  ))
  assert.equal(resizableBuffersAvailable, !forceChunkFallback, 'Browser mode should match the requested buffer path')
  const fileInput = page.locator('.file-input')
  const tabShortcut = process.platform === 'darwin' && browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  async function focusFileInput() {
    const languageButton = page.locator('.lang-switch')
    await languageButton.focus()
    assert.equal(await languageButton.evaluate((button) => button === document.activeElement), true)
    await page.keyboard.press(tabShortcut)
    assert.equal(await fileInput.evaluate((input) => input === document.activeElement), true)
  }
  await focusFileInput()
  assert.notEqual(await page.locator('.upload-btn').evaluate((label) => getComputedStyle(label).outlineStyle), 'none')
  await fileInput.evaluate((input) => {
    window.fileChangeCount = 0
    input.addEventListener('change', () => { window.fileChangeCount++ })
  })
  const invalidFile = { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') }
  await fileInput.setInputFiles(invalidFile)
  await page.locator('.error-banner').waitFor({ state: 'visible' })
  assert.equal(await fileInput.evaluate((input) => input.value), '')

  await fileInput.setInputFiles(invalidFile)
  await page.waitForFunction(() => window.fileChangeCount === 2)
  assert.equal(await fileInput.evaluate((input) => input.value), '')
  assert.ok((await page.locator('.error-banner').textContent()).includes('.pdf'))

  await focusFileInput()
  await fileInput.setInputFiles('docs/doc-101.doc')
  await page.locator('.doc-preview .document-content').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => (
    document.querySelector('.doc-preview [role="status"]')?.textContent?.includes('doc-101.doc')
  ))

  for (const name of ['Zoom out', 'Reset zoom to 100%', 'Zoom in', 'Search document', 'Print / Export PDF']) {
    assert.equal(await page.getByRole('button', { name }).count(), 1, 'English accessible name: ' + name)
  }
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN')
  for (const name of ['缩小', '重置缩放为 100%', '放大', '搜索文档', '打印 / 导出 PDF']) {
    assert.equal(await page.getByRole('button', { name }).count(), 1, 'Chinese accessible name: ' + name)
  }
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.documentElement.lang === 'en')

  if (forceNoHas) {
    const copiedRuleCount = await forceNoHasFallback(page)
    assert.ok(copiedRuleCount > 0, 'Built CSS should contain the unsupported-:has fallback')
    await page.locator('.doc-preview button[aria-label="Search document"]').click()
    const option = page.locator('.search-option').first()
    const checkbox = option.locator('input[type="checkbox"]')
    assert.notEqual(await checkbox.evaluate((input) => getComputedStyle(input).display), 'none')
    await checkbox.check()
    const checkedStyle = await checkbox.evaluate((input) => getComputedStyle(input))
    assert.equal(checkedStyle.outlineStyle, 'solid')
    assert.ok(parseFloat(checkedStyle.outlineWidth) >= 2)
    await checkbox.uncheck()
    await page.locator('.search-bar button[aria-label="Close search"]').click()

    const mobileContext = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    try {
      const mobilePage = await mobileContext.newPage()
      await mobilePage.addInitScript(() => localStorage.setItem('locale', 'en'))
      await mobilePage.goto(previewBaseUrl, { waitUntil: 'networkidle' })
      assert.equal(await mobilePage.evaluate(() => matchMedia('(pointer: coarse)').matches), true)
      await mobilePage.locator('.file-input').setInputFiles('docs/doc-101.doc')
      await mobilePage.locator('.doc-preview .document-content').waitFor({ state: 'attached', timeout: 15_000 })
      assert.ok(await forceNoHasFallback(mobilePage) > 0)
      await mobilePage.locator('.doc-preview button[aria-label="Search document"]').click()
      const mobileOption = mobilePage.locator('.search-option').first()
      const mobileBounds = await mobileOption.boundingBox()
      assert.ok(mobileBounds && mobileBounds.height >= 44, 'Legacy search option should meet 44px coarse-pointer target')
    } finally {
      await mobileContext.close()
    }
  }

  const visibleText = await page.locator('.doc-preview .document-content').innerText()
  const contentMarker = visibleText.split(/\s+/).find((word) => word.length >= 4)
  assert.ok(contentMarker, 'The sample DOC should render readable text')
  await page.locator('.doc-preview button[aria-label="Search document"]').click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('search-input'))
  const searchStatus = page.locator('.search-status')
  assert.equal(await searchStatus.getAttribute('role'), 'status')
  assert.equal(await searchStatus.getAttribute('aria-live'), 'polite')
  assert.equal(await searchStatus.getAttribute('aria-atomic'), 'true')
  assert.equal(await searchStatus.locator('.search-status-visual').textContent(), '')
  assert.equal(await searchStatus.locator('.sr-only').textContent(), '')
  await page.locator('.search-input').fill(contentMarker)
  await page.waitForFunction(() => /^Match 1 of \d+$/.test(document.querySelector('.search-status .sr-only')?.textContent ?? ''))
  assert.match(await searchStatus.locator('.sr-only').textContent() ?? '', /^Match 1 of \d+$/)
  assert.equal(await searchStatus.locator('.search-status-visual').getAttribute('aria-hidden'), 'true')
  assert.match(await searchStatus.locator('.search-status-visual').textContent() ?? '', /^1 \/ \d+$/)
  for (const name of ['Previous match', 'Next match', 'Close search']) {
    assert.equal(await page.getByRole('button', { name }).count(), 1, 'English search accessible name: ' + name)
  }
  const caseOption = page.locator('.search-option').nth(0)
  const caseCheckbox = caseOption.locator('input[type="checkbox"]')
  await page.keyboard.press(tabShortcut)
  assert.equal(await caseCheckbox.evaluate((input) => input === document.activeElement), true)
  assert.notEqual(await caseCheckbox.evaluate((input) => getComputedStyle(input).display), 'none')
  assert.equal(await caseOption.evaluate((label) => getComputedStyle(label).outlineStyle), 'solid')
  await page.keyboard.press('Space')
  assert.equal(await caseCheckbox.isChecked(), true, 'Space should toggle the case-sensitive search option')

  const wordOption = page.locator('.search-option').nth(1)
  const wordCheckbox = wordOption.locator('input[type="checkbox"]')
  await page.keyboard.press(tabShortcut)
  assert.equal(await wordCheckbox.evaluate((input) => input === document.activeElement), true)
  assert.equal(await wordOption.evaluate((label) => getComputedStyle(label).outlineStyle), 'solid')
  await page.keyboard.press('Space')
  assert.equal(await wordCheckbox.isChecked(), true, 'Space should toggle the whole-word search option')
  await page.locator('.search-bar button[aria-label="Close search"]').click()

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
    document.querySelector('.doc-preview [role="status"]')?.textContent?.includes('doc-101.doc')
  ), { timeout: 30_000 })
  assert.equal(await page.locator('.doc-preview [role="status"]').textContent(), 'Document parsing complete: doc-101.doc')
  const remoteText = await page.locator('.doc-preview .document-content').innerText()
  assert.ok(remoteText.includes(contentMarker), 'URL stream should render the source DOC content')
  assert.equal(await page.locator('.doc-info .doc-name').textContent(), 'doc-101.doc')
  const remoteDownloadStarted = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download as text file' }).click()
  const remoteDownload = await remoteDownloadStarted
  assert.equal(remoteDownload.suggestedFilename(), 'doc-101.txt')

  await page.locator('.back-btn').click()
  const templateFile = {
    name: 'template.dot',
    mimeType: 'application/msword',
    buffer: sourceDoc,
  }
  await fileInput.setInputFiles(templateFile)
  await page.locator('.doc-preview .document-content').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => (
    document.querySelector('.doc-preview [role="status"]')?.textContent?.includes('template.dot')
  ))
  const templateText = await page.locator('.doc-preview .document-content').innerText()
  assert.ok(templateText.includes(contentMarker), 'DOT template should render DOC-compatible content')

  const bufferMode = forceChunkFallback ? 'chunk fallback' : 'resizable buffer'
  console.log('Verified ' + browserName + ' DOC/DOT upload, same-file retry, >1 MiB URL/Worker parsing (' + bufferMode + '), and TXT, HTML, and Markdown downloads.')
} finally {
  try {
    await browser?.close()
  } finally {
    if (!previewServerClosed) {
      const serverClosed = once(previewServer, 'close')
      previewServer.kill('SIGTERM')
      await serverClosed
    }
  }
}
