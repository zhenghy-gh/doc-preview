from playwright.sync_api import sync_playwright
import os

def test_doc_preview():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            print(f"文件存在: {file_path}")
            print(f"文件大小: {os.path.getsize(file_path)} bytes\n")

            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            preview_content = page.locator('.preview-content')
            if preview_content.is_visible():
                html_content = page.locator('.document-content').inner_html()
                print("=== 解析结果 ===\n")
                print(html_content[:1000])

                print("\n\n=== 检查格式 ===")
                if '<h1' in html_content:
                    h1_text = page.locator('.document-content h1').inner_text()
                    h1_style = page.locator('.document-content h1').get_attribute('style')
                    print(f"✅ 第1行标题: {h1_text}")
                    print(f"   样式: {h1_style}")
                    if h1_style and 'center' in h1_style:
                        print("   ✅ 居中对齐")
                    if h1_style and ('bold' in h1_style or '700' in h1_style):
                        print("   ✅ 加粗")
                    if h1_style and '2.2rem' in h1_style:
                        print("   ✅ 二号字体")

                if '<h2' in html_content:
                    h2_text = page.locator('.document-content h2').inner_text()
                    h2_style = page.locator('.document-content h2').get_attribute('style')
                    print(f"\n✅ 第2行标题: {h2_text}")
                    print(f"   样式: {h2_style}")
                    if h2_style and 'center' in h2_style:
                        print("   ✅ 居中对齐")
                    if h2_style and ('bold' in h2_style or '700' in h2_style):
                        print("   ✅ 加粗")
                    if h2_style and '3.2rem' in h2_style:
                        print("   ✅ 小初字体")

                print("\n=== 检查关键内容 ===")
                if '清川市富宁区监察委员会' in html_content:
                    print("✅ 第1行：清川市富宁区监察委员会 - 已找到")
                else:
                    print("❌ 第1行：清川市富宁区监察委员会 - 未找到")

                if '讯' in html_content and '问' in html_content and '笔' in html_content and '录' in html_content:
                    print("✅ 第2行：讯问笔录 - 已找到")
                    if '讯 问 笔 录' in html_content:
                        print("   带空格的版本也已找到")
                else:
                    print("❌ 第2行：讯问笔录 - 未完整找到")
            else:
                error_container = page.locator('.error-container')
                if error_container.is_visible():
                    error_text = error_container.inner_text()
                    print(f"错误: {error_text}")

        browser.close()

if __name__ == '__main__':
    test_doc_preview()
