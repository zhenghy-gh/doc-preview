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
            print(f"✅ 文件存在: {file_path}\n")

            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            # 获取第3行
            paragraphs = page.locator('.document-content p').all()
            if len(paragraphs) > 0:
                p3 = paragraphs[0]

                print("=== 第3行字符详细分析 ===\n")

                # 获取完整的HTML
                html = p3.inner_html()
                print(f"【完整HTML】\n{html[:500]}\n")

                # 分析每个字符
                spans = p3.locator('span').all()
                print(f"【字符分析】(共 {len(spans)} 个字符元素)\n")

                for i, span in enumerate(spans):
                    char = span.inner_text()
                    style = span.get_attribute('style')

                    font = "仿宋" if "仿宋" in style else "Times"
                    underline = "✓" if "underline" in style else "✗"

                    print(f"{i+1:2d}. '{char}' - {font:8s} 下划线: {underline}")

                # 检查冒号
                print(f"\n【特殊字符检查】")
                if '：' in html:
                    print("✅ 全角冒号 '：' 已找到")
                else:
                    print("❌ 全角冒号 '：' 未找到")

                if ':' in html:
                    print("✅ 半角冒号 ':' 已找到")
                else:
                    print("❌ 半角冒号 ':' 未找到")

        browser.close()

if __name__ == '__main__':
    test()
