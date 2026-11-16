import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { chromium, firefox, webkit } from 'playwright'

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local preview port')
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return address.port
}

async function getMinimumTextContrasts(page, pairs) {
  return page.evaluate((items) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
      const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const ratio = (foreground, background) => {
      const a = luminance(foreground)
      const b = luminance(background)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    return Object.fromEntries(items.map(({ name, foregroundSelector, backgroundSelector }) => {
      const foreground = getComputedStyle(document.querySelector(foregroundSelector)).color
      const backgroundStyle = getComputedStyle(document.querySelector(backgroundSelector))
      const backgrounds = backgroundStyle.backgroundImage === 'none'
        ? [backgroundStyle.backgroundColor]
        : backgroundStyle.backgroundImage.match(/rgb\([^)]*\)/g) ?? [backgroundStyle.backgroundColor]
      return [name, Math.min(...backgrounds.map(background => ratio(foreground, background)))]
    }))
  }, pairs)
}
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
const previewPort = await getAvailablePort()
const previewBaseUrl = 'http://127.0.0.1:' + previewPort + '/doc-preview/'
const previewServer = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let previewServerError
let previewServerClosed = false
let previewServerReady = false
previewServer.stdout.on('data', (chunk) => {
  const output = chunk.toString()
  if (stripVTControlCharacters(output).includes(previewBaseUrl)) previewServerReady = true
  process.stdout.write(chunk)
})
previewServer.stderr.on('data', (chunk) => process.stderr.write(chunk))
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
    if (response.ok && previewServerReady) return
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
  const browserContext = await browser.newContext({ acceptDownloads: true, colorScheme: 'light' })
  const page = await browserContext.newPage()
  const forceChunkFallback = process.argv.includes('--force-chunk-fallback')
  const forceNoHas = process.argv.includes('--force-no-has')
  await page.addInitScript((disableResizableBuffers) => {
    localStorage.setItem('locale', 'en')
    if (!sessionStorage.getItem('browser-smoke-theme-initialized')) {
      localStorage.removeItem('dark-mode')
      sessionStorage.setItem('browser-smoke-theme-initialized', 'true')
    }
    if (disableResizableBuffers) {
      Object.defineProperty(ArrayBuffer.prototype, 'resize', { configurable: true, value: undefined })
    }
  }, forceChunkFallback)
  await page.goto(previewBaseUrl, { waitUntil: 'networkidle' })
  assert.equal(await page.title(), 'DOC File Online Preview')
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  const appThemeButton = page.locator('.header-top .theme-btn:not(.lang-switch)')
  assert.equal(await appThemeButton.getAttribute('aria-label'), 'Dark mode')
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'light dark')
  const uploadSurface = page.locator('.upload-area')
  assert.equal(await uploadSurface.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
  const lightActionContrast = await getMinimumTextContrasts(page, [
    { name: 'upload', foregroundSelector: '.upload-btn', backgroundSelector: '.upload-btn' },
    { name: 'url', foregroundSelector: '.url-btn', backgroundSelector: '.url-btn' },
    { name: 'header copy', foregroundSelector: '.header p', backgroundSelector: '.app-container' },
  ])
  for (const [name, contrast] of Object.entries(lightActionContrast)) {
    assert.ok(contrast >= 4.5, name + ' foreground contrast is ' + contrast.toFixed(2) + ':1')
  }
  await appThemeButton.click()
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.upload-area')).backgroundColor === 'rgb(22, 33, 62)')
  assert.equal(await page.locator('.upload-area h2').evaluate((el) => getComputedStyle(el).color), 'rgb(224, 224, 224)')
  assert.equal(await page.locator('.header').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(22, 33, 62)')
  assert.equal(await page.locator('.app-container').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(26, 26, 46)')
  assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'dark')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), 'dark')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('.header-top .theme-btn:not(.lang-switch)')?.getAttribute('aria-pressed') === 'true')
  assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'dark')
  assert.equal(await page.locator('html').evaluate(html => html.classList.contains('dark')), true)
  await page.emulateMedia({ colorScheme: 'dark' })
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  await page.emulateMedia({ colorScheme: 'light' })
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  await appThemeButton.click()
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'false')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.upload-area')).backgroundColor === 'rgb(255, 255, 255)')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), null)
  assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), 'light dark')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'false')
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.title === 'DOC文件在线预览' && document.documentElement.lang === 'zh-CN')
  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.title === 'DOC File Online Preview' && document.documentElement.lang === 'en')
  assert.equal(await page.locator('meta[name="text-scale"]').getAttribute('content'), 'scale')
  await page.locator('.url-btn').click()
  assert.equal(await page.locator('.error-banner').textContent(), 'Enter a document URL')
  assert.equal(await page.locator('.sr-only').first().textContent(), 'Enter a document URL')
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
    document.querySelector('.doc-preview .sr-only[role="status"]')?.textContent?.includes('doc-101.doc')
  ))
  const skipLink = page.locator('.doc-preview .skip-link')
  assert.equal(await skipLink.getAttribute('href'), '#document-content')
  await skipLink.focus()
  await skipLink.press('Enter')
  assert.equal(await page.locator('#document-content').evaluate((element) => element === document.activeElement), true)
  assert.equal(await page.getByRole('status', { name: 'Page 1 of 1' }).count(), 1)
  const previewThemeButton = page.locator('.doc-preview .toolbar-right button[aria-label="Dark mode"]')
  assert.equal(await previewThemeButton.getAttribute('aria-pressed'), 'false')
  await previewThemeButton.click()
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), 'dark')
  await appThemeButton.click()
  assert.equal(await previewThemeButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), null)

  assert.equal(await page.locator('.lang-switch').getAttribute('title'), 'Switch language')
  assert.equal(await page.locator('.lang-switch').getAttribute('aria-label'), '中文, switch to Chinese')
  assert.equal(await page.getByRole('button', { name: '中文, switch to Chinese' }).count(), 1)
  for (const name of [
    'Zoom out',
    'Reset zoom to 100%',
    'Zoom in',
    'Search document',
    'Print / Export PDF',
  ]) {
    assert.equal(await page.getByRole('button', { name }).count(), 1, 'English accessible name: ' + name)
  }
  const skipLinkContrast = await getMinimumTextContrasts(page, [
    { name: 'skip link', foregroundSelector: '.doc-preview .skip-link', backgroundSelector: '.doc-preview .skip-link' },
  ])
  assert.ok(skipLinkContrast['skip link'] >= 4.5, 'Skip link contrast is ' + skipLinkContrast['skip link'].toFixed(2) + ':1')
  const fontButton = page.getByRole('button', { name: 'Web Font' })
  assert.equal(await fontButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await fontButton.getAttribute('title'), 'Enable Web Font')
  await fontButton.click()
  assert.equal(await fontButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await fontButton.getAttribute('title'), 'Disable Web Font')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.header-btn.active')).backgroundColor === 'rgb(77, 95, 199)')
  const activeFontContrast = await getMinimumTextContrasts(page, [
    { name: 'active Web Font control', foregroundSelector: '.header-btn.active', backgroundSelector: '.header-btn.active' },
  ])
  assert.ok(activeFontContrast['active Web Font control'] >= 4.5, 'Active toolbar contrast is ' + activeFontContrast['active Web Font control'].toFixed(2) + ':1')
  await fontButton.click()
  assert.equal(await fontButton.getAttribute('aria-pressed'), 'false')
  const readerButton = page.getByRole('button', { name: 'Reader mode' })
  assert.equal(await readerButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await readerButton.getAttribute('title'), 'Enter reader mode')
  await readerButton.click()
  assert.equal(await readerButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await readerButton.getAttribute('title'), 'Exit reader mode')
  await readerButton.click()
  assert.equal(await readerButton.getAttribute('aria-pressed'), 'false')

  const shortcutsButton = page.getByRole('button', { name: 'Shortcuts', exact: true })
  await shortcutsButton.focus()
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)
  await shortcutsButton.click()
  const shortcutsDialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  assert.equal(await shortcutsDialog.count(), 1)
  assert.equal(await page.locator('.shortcuts-close').evaluate((button) => button === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await shortcutsDialog.evaluate((dialog) => dialog.matches(':modal')), true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await shortcutsDialog.evaluate((dialog) => dialog.matches(':modal')), true)
  await page.locator('.shortcuts-close').focus()
  await page.keyboard.press('Escape')
  await shortcutsDialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.toolbar-btn[aria-label="Shortcuts"]'))
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)

  await shortcutsButton.focus()
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)
  await shortcutsButton.click()
  const dialogBounds = await page.locator('.shortcuts-panel').boundingBox()
  assert.ok(dialogBounds)
  await page.mouse.click(dialogBounds.x - 8, dialogBounds.y - 8)
  await shortcutsDialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.toolbar-btn[aria-label="Shortcuts"]'))
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)

  await shortcutsButton.focus()
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)
  await shortcutsButton.click()
  await page.locator('.shortcuts-panel').evaluate((dialog) => dialog.close())
  await shortcutsDialog.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.toolbar-btn[aria-label="Shortcuts"]'))
  assert.equal(await shortcutsButton.evaluate((button) => button === document.activeElement), true)

  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN')
  assert.equal(await page.locator('.lang-switch').getAttribute('title'), '切换语言')
  assert.equal(await page.locator('.lang-switch').getAttribute('aria-label'), 'EN，切换到英文')
  assert.equal(await page.getByRole('button', { name: 'EN，切换到英文' }).count(), 1)
  for (const name of ['缩小', '重置缩放为 100%', '放大', '搜索文档', '打印 / 导出 PDF']) {
    assert.equal(await page.getByRole('button', { name }).count(), 1, 'Chinese accessible name: ' + name)
  }
  const zhFontButton = page.getByRole('button', { name: '网页字体' })
  assert.equal(await zhFontButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await zhFontButton.getAttribute('title'), '启用 Web Font')
  await zhFontButton.click()
  assert.equal(await zhFontButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await zhFontButton.getAttribute('title'), '关闭 Web Font')
  await zhFontButton.click()
  assert.equal(await zhFontButton.getAttribute('aria-pressed'), 'false')
  const zhReaderButton = page.getByRole('button', { name: '阅读模式' })
  assert.equal(await zhReaderButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await zhReaderButton.getAttribute('title'), '进入阅读模式')
  await zhReaderButton.click()
  assert.equal(await zhReaderButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await zhReaderButton.getAttribute('title'), '退出阅读模式')
  await zhReaderButton.click()
  assert.equal(await zhReaderButton.getAttribute('aria-pressed'), 'false')

  await page.locator('.lang-switch').click()
  await page.waitForFunction(() => document.documentElement.lang === 'en')
  assert.equal(await page.locator('.lang-switch').getAttribute('title'), 'Switch language')
  assert.equal(await page.locator('.lang-switch').getAttribute('aria-label'), '中文, switch to Chinese')

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
  const searchInput = page.getByRole('textbox', { name: 'Search document' })
  assert.equal(await searchInput.count(), 1)
  assert.equal(await page.getByRole('checkbox', { name: 'Case sensitive (Aa)' }).count(), 1)
  assert.equal(await page.getByRole('checkbox', { name: 'Whole word (W)' }).count(), 1)
  const searchStatus = page.locator('.search-status')
  assert.equal(await searchStatus.getAttribute('role'), 'status')
  assert.equal(await searchStatus.getAttribute('aria-live'), 'polite')
  assert.equal(await searchStatus.getAttribute('aria-atomic'), 'true')
  assert.equal(await searchStatus.locator('.search-status-visual').textContent(), '')
  assert.equal(await searchStatus.locator('.sr-only').textContent(), '')
  await page.locator('.search-input').fill(contentMarker)
  await page.waitForFunction(() => /^Match 1 of \d+$/.test(document.querySelector('.search-status .sr-only')?.textContent ?? ''))
  assert.match(await searchStatus.locator('.sr-only').textContent() ?? '', /^Match 1 of \d+$/)
  await page.locator('.search-input').fill('e')
  await page.waitForFunction(() => /^Match 1 of \d+$/.test(document.querySelector('.search-status .sr-only')?.textContent ?? ''))
  const matchCount = Number((await searchStatus.locator('.sr-only').textContent())?.match(/Match 1 of (\d+)/)?.[1])
  assert.ok(matchCount > 1, 'The keyboard smoke query should match multiple characters')
  const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press('Shift+F3')
  await page.waitForFunction((total) => document.querySelector('.search-status .sr-only')?.textContent === 'Match ' + total + ' of ' + total, matchCount)
  await page.keyboard.press(primaryModifier + '+Shift+G')
  await page.waitForFunction((total) => document.querySelector('.search-status .sr-only')?.textContent === 'Match ' + (total - 1) + ' of ' + total, matchCount)
  await page.keyboard.press('F3')
  await page.waitForFunction((total) => document.querySelector('.search-status .sr-only')?.textContent === 'Match ' + total + ' of ' + total, matchCount)
  await page.keyboard.press(primaryModifier + '+G')
  await page.waitForFunction((total) => document.querySelector('.search-status .sr-only')?.textContent === 'Match 1 of ' + total, matchCount)
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
    document.querySelector('.doc-preview .sr-only[role="status"]')?.textContent?.includes('doc-101.doc')
  ), { timeout: 30_000 })
  assert.equal(await page.locator('.doc-preview .sr-only[role="status"]').textContent(), 'Document parsing complete: doc-101.doc')
  const remotePreviewThemeButton = page.locator('.doc-preview .toolbar-right button[aria-label="Dark mode"]')
  assert.equal(await remotePreviewThemeButton.getAttribute('aria-pressed'), 'false')
  await remotePreviewThemeButton.click()
  assert.equal(await appThemeButton.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), 'dark')
  await appThemeButton.click()
  assert.equal(await remotePreviewThemeButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await page.evaluate(() => localStorage.getItem('dark-mode')), null)
  const remoteText = await page.locator('.doc-preview .document-content').innerText()
  assert.ok(remoteText.includes(contentMarker), 'URL stream should render the source DOC content')
  assert.equal(await page.locator('.doc-info .doc-name').textContent(), 'doc-101.doc')
  const appPreviewFileName = await page.locator('.preview-header .file-name').textContent()
  assert.equal(appPreviewFileName, 'doc-101.doc')
  assert.ok(!appPreviewFileName.includes('browser-smoke'))
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
    document.querySelector('.doc-preview .sr-only[role="status"]')?.textContent?.includes('template.dot')
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
