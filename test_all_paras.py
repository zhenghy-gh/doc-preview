from playwright.sync_api import sync_playwright
import os

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_messages = []
        page.on("console", lambda msg: console_messages.append((msg.type, msg.text)))

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            # 打印所有日志
            print("=== 控制台日志 ===")
            for msg_type, msg_text in console_messages:
                if 'DOC Parser' in msg_text:
                    print(msg_text)

            # 检查所有段落
            paragraphs = page.locator('.document-content p').all()
            print(f"\n=== 所有段落 (共 {len(paragraphs)} 个) ===\n")

            for i, p in enumerate(paragraphs[:5]):
                text = p.inner_text()
                print(f"段落 #{i+1}: {text}")

                # 检查冒号
                if '：' in text:
                    print(f"  ✅ 有全角冒号")
                if ':' in text:
                    print(f"  ✅ 有半角冒号")
                if '：' not in text and ':' not in text:
                    print(f"  ❌ 无冒号")

        browser.close()

if __name__ == '__main__':
    test()
