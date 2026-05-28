from playwright.sync_api import sync_playwright
import os

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_messages = []
        page.on("console", lambda msg: console_messages.append(msg.text))

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            # 打印初步提取的段落
            print("=== 检查控制台日志中的段落 ===\n")
            for msg in console_messages:
                if '初步提取到' in msg:
                    print(msg)

            # 获取所有段落
            paragraphs = page.locator('.document-content p').all()
            print(f"\n=== 提取的段落数量: {len(paragraphs)} ===\n")

            # 检查第一个段落的原始文本
            if len(paragraphs) > 0:
                p1 = paragraphs[0]
                text = p1.inner_text()

                print(f"第1个段落文本: '{text}'")
                print(f"文本长度: {len(text)}")

                # 检查冒号
                print(f"\n文本中包含的字符:")
                for i, char in enumerate(text[:20]):
                    print(f"  {i}: '{char}' (U+{ord(char):04X})")

                # 检查是否有冒号
                fullwidth_colon = '：'
                halfwidth_colon = ':'

                if fullwidth_colon in text:
                    print(f"\n✅ 找到全角冒号 '{fullwidth_colon}'")
                    pos = text.find(fullwidth_colon)
                    print(f"   位置: {pos}")
                    print(f"   上下文: ...{text[max(0,pos-5):pos+5]}...")
                else:
                    print(f"\n❌ 未找到全角冒号 '{fullwidth_colon}'")

                if halfwidth_colon in text:
                    print(f"✅ 找到半角冒号 '{halfwidth_colon}'")
                else:
                    print(f"❌ 未找到半角冒号 '{halfwidth_colon}'")

        browser.close()

if __name__ == '__main__':
    test()
