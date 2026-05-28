#!/usr/bin/env python3
"""
分析DOC文档中的字符格式信息，特别是下划线
"""

def analyze_doc_format():
    doc_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

    with open(doc_path, 'rb') as f:
        data = f.read()

    print(f"文件大小: {len(data)} bytes\n")

    # 查找"讯问时间"的位置
    search_text = "讯问时间".encode('utf-16-le')
    pos = data.find(search_text)

    if pos > 0:
        print(f"找到 '讯问时间' 在位置 {pos}\n")

        # 分析该位置附近的字节
        print("=== 分析字符格式 ===\n")

        # 检查UTF-16编码的字符
        for i in range(pos, pos + 100, 2):
            if i + 1 >= len(data):
                break

            byte1 = data[i]
            byte2 = data[i + 1]
            char_code = byte2 << 8 | byte1

            if char_code == 0:
                continue

            char_str = chr(char_code) if 0x20 <= char_code < 0xFFFF else '?'
            print(f"位置 {i}: 0x{byte1:02X} 0x{byte2:02X} => U+{char_code:04X} '{char_str}'")

            # 检查是否有格式标记
            # 在DOC中，某些控制字符可能表示格式变化
            if byte1 == 0x08:  # 特殊格式标记
                print(f"  [格式标记]")
            elif byte1 == 0x01 and byte2 >= 0x80:  # 可能表示下划线
                print(f"  [可能的格式: 下划线等]")

    # 查找FIB结构
    print("\n\n=== 查找FIB (File Information Block) ===")

    for i in range(0, min(1000, len(data))):
        if data[i] == 0xEC and data[i+1] == 0xA5:  # FIB magic
            print(f"找到FIB magic在位置 {i}")
            break

    # 查找Clx结构
    print("\n\n=== 分析WordDocument流 ===")

    # 扫描整个文件查找可能的格式信息
    print("扫描可能的格式控制字符...")

    underline_markers = []
    for i in range(len(data) - 1):
        # 检查是否有可能的下划线标记
        if data[i] == 0x00 and data[i+1] == 0x80:  # 可能的格式标记
            pos = i
            # 查找附近的文本
            context_start = max(0, pos - 20)
            context_end = min(len(data), pos + 20)
            context = data[context_start:context_end]

            # 尝试解码为UTF-16
            try:
                text = context.decode('utf-16-le', errors='ignore')
                if '2024' in text or '讯问' in text:
                    print(f"\n位置 {pos}: 发现格式标记")
                    print(f"  上下文: {text[:40]}")
            except:
                pass

if __name__ == '__main__':
    analyze_doc_format()
