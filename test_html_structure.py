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

                print("=== 分析HTML结构 ===\n")

                # 找到位置24附近的字符
                pos = 24
                print(f"位置 {pos} 附近的HTML:")
                print(html[max(0, pos-30):min(len(html), pos+50)])
                print()

                # 打印前200个字符
                print("HTML前200字符:")
                print(html[:200])
                print()

                # 检查是否在span外面
                if html.count('<span') > 0:
                    first_span = html.find('<span')
                    print(f"第一个<span>在位置: {first_span}")

                    # 检查位置24之前是否有文本
                    before_span = html[:first_span]
                    if before_span.strip():
                        print(f"\n⚠️ 在第一个<span>之前有文本: '{before_span.strip()}'")
                    else:
                        print(f"\n✅ 位置24的冒号应该在<span>内")

        browser.close()

if __name__ == '__main__':
    test()
