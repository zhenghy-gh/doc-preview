from playwright.sync_api import sync_playwright
import os
import re

def test_doc_preview():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_messages = []
        page.on("console", lambda msg: console_messages.append(msg.text))

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            print(f"文件存在: {file_path}")
            print(f"文件大小: {os.path.getsize(file_path)} bytes\n")

            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            print("=== 控制台日志 ===")
            for msg in console_messages:
                if '[DOC Parser]' in msg:
                    print(msg)

            preview_content = page.locator('.preview-content')
            if preview_content.is_visible():
                html_content = page.locator('.document-content').inner_html()

                print("\n=== 检查前3个段落 ===")
                paragraphs = page.locator('.document-content > *').all()[:3]
                for i, elem in enumerate(paragraphs):
                    tag_name = elem.evaluate("el => el.tagName")
                    text = elem.inner_text()
                    style = elem.get_attribute('style') or 'None'
                    print(f"\n段落 #{i+1}:")
                    print(f"  标签: <{tag_name}>")
                    print(f"  文本: {text}")
                    print(f"  长度: {len(text)}")
                    print(f"  样式: {style}")

                    normalized = re.sub(r'\s+', '', text)
                    is_title2 = (('讯问' in normalized or '询问' in normalized) and
                               ('笔' in normalized or '录' in normalized) and
                               len(text) < 15)
                    print(f"  符合标题2条件: {is_title2}")
                    print(f"  规范化文本: {normalized}")

        browser.close()

if __name__ == '__main__':
    test_doc_preview()
