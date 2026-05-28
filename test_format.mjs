import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function test() {
  console.log('=== 开始测试带格式的 DOC 预览 ===\n')

  const docPath = join(__dirname, '6a164d2b7d5a1fdadbc11541.doc')

  if (!existsSync(docPath)) {
    console.error(`❌ 文件不存在: ${docPath}`)
    return
  }

  console.log(`✅ 文件存在: ${docPath}`)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    await page.goto('http://localhost:5173')

    const fileInput = await page.$('input[type="file"]')
    if (!fileInput) {
      console.error('❌ 未找到文件上传输入框')
      return
    }

    await fileInput.setInputFiles(docPath)

    await page.waitForSelector('.document-content', { timeout: 10000 })

    const content = await page.$eval('.document-content', el => el.innerHTML)

    console.log('\n=== 解析结果 ===\n')

    const tempDiv = await page.evaluate((html) => {
      const div = document.createElement('div')
      div.innerHTML = html
      return div
    }, content)

    const h1Text = await tempDiv.$eval('h1', el => el.textContent).catch(() => null)
    const h1Style = await tempDiv.$eval('h1', el => el.getAttribute('style')).catch(() => null)

    if (h1Text) {
      console.log(`✅ 第1行: ${h1Text}`)
      console.log(`   样式: ${h1Style}`)
      if (h1Style && h1Style.includes('center')) {
        console.log('   ✅ 居中对齐')
      }
      if (h1Style && (h1Style.includes('bold') || h1Style.includes('700'))) {
        console.log('   ✅ 加粗')
      }
      if (h1Style && h1Style.includes('2.2rem')) {
        console.log('   ✅ 二号字体')
      }
    }

    const h2Text = await tempDiv.$eval('h2', el => el.textContent).catch(() => null)
    const h2Style = await tempDiv.$eval('h2', el => el.getAttribute('style')).catch(() => null)

    if (h2Text) {
      console.log(`✅ 第2行: ${h2Text}`)
      console.log(`   样式: ${h2Style}`)
      if (h2Style && h2Style.includes('center')) {
        console.log('   ✅ 居中对齐')
      }
      if (h2Style && (h2Style.includes('bold') || h2Style.includes('700'))) {
        console.log('   ✅ 加粗')
      }
      if (h2Style && h2Style.includes('3.2rem')) {
        console.log('   ✅ 小初字体')
      }
    }

    console.log('\n=== 完整HTML内容预览（前1000字符）===\n')
    console.log(content.substring(0, 1000))

    console.log('\n✅ 测试完成')

  } catch (error) {
    console.error('❌ 测试失败:', error)
  } finally {
    await browser.close()
  }
}

test()
