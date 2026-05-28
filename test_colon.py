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

            paragraphs = page.locator('.document-content p').all()
            if len(paragraphs) > 0:
                p3 = paragraphs[0]

                # 获取完整的HTML
                html = p3.inner_html()

                print("=== 查找冒号位置 ===\n")
                print(f"HTML长度: {len(html)} 字符\n")

                # 查找冒号
                colon_pos = html.find(':')
                if colon_pos > 0:
                    print(f"找到冒号 ':' 在位置 {colon_pos}")
                    # 显示冒号前后的内容
                    start = max(0, colon_pos - 50)
                    end = min(len(html), colon_pos + 50)
                    print(f"\n冒号前后100字符:")
                    print(html[start:end])
                    print()

                    # 显示该字符的详细信息
                    print(f"\n冒号所在span:")
                    # 找到包含冒号的span
                    span_with_colon = None
                    for span in p3.locator('span').all():
                        if ':' in span.inner_text():
                            span_with_colon = span
                            break

                    if span_with_colon:
                        print(f"  字符: '{span_with_colon.inner_text()}'")
                        print(f"  样式: {span_with_colon.get_attribute('style')}")
                    else:
                        print("  ❌ 未找到包含冒号的span")
                        print(f"\n  检查HTML中是否有冒号:")
                        print(f"  ':' 在HTML中: {html.count(':')}")
                        print(f"  '：' 在HTML中: {html.count('：')}")

        browser.close()

if __name__ == '__main__':
    test()
