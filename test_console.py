from playwright.sync_api import sync_playwright
import os

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 监听console消息
        logs = []
        page.on("console", lambda msg: logs.append(msg.text))

        page.goto('http://localhost:5175')
        page.wait_for_load_state('networkidle')

        file_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

        if os.path.exists(file_path):
            page.set_input_files('input[type="file"]', file_path)
            page.wait_for_timeout(3000)

            # 打印控制台日志
            print("=== 控制台日志 ===")
            for log in logs:
                if 'DOC' in log or 'FIB' in log or '字符' in log:
                    print(log)

        browser.close()

if __name__ == '__main__':
    test()
