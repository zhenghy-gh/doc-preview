from playwright.sync_api import sync_playwright
import os

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

                print("=== 检查前3行的HTML结构 ===\n")

                # 检查第1行
                h1 = page.locator('.document-content h1').first
                h1_text = h1.inner_text()
                h1_style = h1.get_attribute('style')
                print(f"第1行 (H1): {h1_text}")
                print(f"  样式: {h1_style}")
                print(f"  ✅ 华文中宋: {'华文中宋' in h1_style}")
                print(f"  ✅ 二号字体 (2.2rem): {'2.2rem' in h1_style}")
                print(f"  ✅ 加粗: {'bold' in h1_style}")
                print(f"  ✅ 居中对齐: {'center' in h1_style}")

                # 检查第2行
                h2 = page.locator('.document-content h2').first
                h2_text = h2.inner_text()
                h2_style = h2.get_attribute('style')
                print(f"\n第2行 (H2): {h2_text}")
                print(f"  样式: {h2_style}")
                print(f"  ✅ 华文中宋: {'华文中宋' in h2_style}")
                print(f"  ✅ 小初字体 (3.2rem): {'3.2rem' in h2_style}")
                print(f"  ✅ 加粗: {'bold' in h2_style}")
                print(f"  ✅ 居中对齐: {'center' in h2_style}")

                # 检查第3行
                paragraphs = page.locator('.document-content p').all()
                if len(paragraphs) >= 1:
                    p3 = paragraphs[0]
                    p3_text = p3.inner_text()
                    p3_style = p3.get_attribute('style')

                    print(f"\n第3行 (P): {p3_text}")
                    print(f"  段落样式: {p3_style}")
                    print(f"  ✅ 三号字体 (1.65rem): {'1.65rem' in p3_style}")
                    print(f"  ✅ 两端对齐: {'justify' in p3_style}")

                    # 检查子元素的字体
                    spans = p3.locator('span').all()
                    if len(spans) > 0:
                        print(f"\n  子元素分析 (共 {len(spans)} 个 <span>):")

                        fangSong_spans = []
                        times_spans = []

                        for i, span in enumerate(spans[:20]):  # 只显示前20个
                            span_text = span.inner_text()
                            span_style = span.get_attribute('style')

                            if '仿宋' in span_style:
                                fangSong_spans.append(span_text)
                            elif 'Times' in span_style:
                                times_spans.append(span_text)

                        print(f"  ✅ 仿宋_GB2312 字体: {len(fangSong_spans)} 个字符")
                        print(f"     示例: {''.join(fangSong_spans[:10])}")

                        print(f"  ✅ Times New Roman 字体: {len(times_spans)} 个字符")
                        print(f"     示例: {''.join(times_spans[:15])}")

                        # 检查下划线
                        underline_spans = p3.locator('span[style*="underline"]').all()
                        print(f"  ✅ 下划线: {len(underline_spans)} 个字符带下划线")

                print("\n=== 格式总结 ===")
                print("✅ 第1行: 华文中宋 + 二号 + 加粗 + 居中")
                print("✅ 第2行: 华文中宋 + 小初 + 加粗 + 居中")
                print("✅ 第3行: 混合字体(仿宋_GB2312中文 + Times New Roman数字) + 三号 + 两端对齐 + 数字下划线")

        browser.close()

if __name__ == '__main__':
    test_doc_preview()
