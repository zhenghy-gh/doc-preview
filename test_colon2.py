from playwright.sync_api import sync_playwright
import os
import re

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

                print("=== 查找所有冒号 ===\n")

                # 查找所有冒号
                colon_positions = [m.start() for m in re.finditer(':', html)]
                print(f"找到 {len(colon_positions)} 个冒号 ':'\n")

                # 显示前5个冒号的上下文
                for i, pos in enumerate(colon_positions[:5]):
                    print(f"冒号 #{i+1} 在位置 {pos}:")
                    start = max(0, pos - 20)
                    end = min(len(html), pos + 30)
                    context = html[start:end]
                    print(f"  上下文: {context}")
                    print()

                # 检查第一个<span>内的冒号
                print("\n=== 检查第一个span ===")
                first_span = page.locator('.document-content p span').first
                span_html = first_span.evaluate('el => el.outerHTML')
                print(f"第一个span HTML: {span_html}")

                # 获取文本
                text = p3.inner_text()
                print(f"\n显示的文本: {text}")

                # 检查文本中是否有冒号
                print(f"\n文本中 ':' 数量: {text.count(':')}")
                print(f"文本中 '：' 数量: {text.count('：')}")

        browser.close()

if __name__ == '__main__':
    test()
