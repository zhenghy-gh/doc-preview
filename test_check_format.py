from playwright.sync_api import sync_playwright
import os
import json

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
                print("=== HTML结构 ===\n")
                print(html_content[:800])

                print("\n\n=== 检查H1和H2标签 ===")
                h1_elements = page.locator('.document-content h1').all()
                h2_elements = page.locator('.document-content h2').all()

                print(f"\n找到 {len(h1_elements)} 个 <h1> 标签")
                for i, h1 in enumerate(h1_elements):
                    text = h1.inner_text()
                    style = h1.get_attribute('style')
                    print(f"  H1 #{i+1}: {text}")
                    print(f"    样式: {style}")

                print(f"\n找到 {len(h2_elements)} 个 <h2> 标签")
                for i, h2 in enumerate(h2_elements):
                    text = h2.inner_text()
                    style = h2.get_attribute('style')
                    print(f"  H2 #{i+1}: {text}")
                    print(f"    样式: {style}")

                if len(h1_elements) == 0 and len(h2_elements) == 0:
                    print("\n⚠️ 没有找到任何标题标签，检查前3个段落:")
                    paragraphs = page.locator('.document-content p').all()[:3]
                    for i, p_elem in enumerate(paragraphs):
                        text = p_elem.inner_text()
                        style = p_elem.get_attribute('style')
                        print(f"  P #{i+1}: {text}")
                        print(f"    样式: {style}")

            else:
                error_container = page.locator('.error-container')
                if error_container.is_visible():
                    error_text = error_container.inner_text()
                    print(f"错误: {error_text}")

        browser.close()

if __name__ == '__main__':
    test_doc_preview()
