from playwright.sync_api import sync_playwright
import os

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            # 获取第3行
            paragraphs = page.locator('.document-content p').all()
            if len(paragraphs) > 0:
                p3 = paragraphs[0]
                html = p3.inner_html()

                print("=== 第3行HTML结构 ===\n")
                print(html[:800])

                print("\n\n=== 检查<span>标签 ===")
                spans = p3.locator('span').all()
                print(f"找到 {len(spans)} 个 <span> 标签")

                if len(spans) > 0:
                    print("\n【字符级样式】")
                    for i, span in enumerate(spans[:10]):
                        text = span.inner_text()
                        style = span.get_attribute('style')
                        print(f"  {i+1}. '{text}' - {style}")

        browser.close()

if __name__ == '__main__':
    test()
