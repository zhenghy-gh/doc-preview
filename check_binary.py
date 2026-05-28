import os

def check_doc_binary():
    doc_path = '/Users/zhenghaiyang/02个人项目/doc-preview/6a164d2b7d5a1fdadbc11541.doc'

    with open(doc_path, 'rb') as f:
        data = f.read()

    print(f"文件大小: {len(data)} bytes\n")

    # 查找"讯问时间"的位置
    search_text = "讯问时间".encode('utf-16-le')
    pos = data.find(search_text)

    if pos > 0:
        print(f"找到 '讯问时间' 在位置 {pos}\n")

        # 显示该位置前后的字节
        print("该位置前20字节:")
        for i in range(max(0, pos-20), pos):
            print(f"{i}: {hex(data[i])} ({chr(data[i]) if 32 <= data[i] < 127 else '?'})")

        print("\n该位置后50字节:")
        for i in range(pos, min(len(data), pos+50)):
            byte1 = data[i]
            byte2 = data[i+1] if i+1 < len(data) else 0
            char_code = byte2 << 8 | byte1
            print(f"{i}: {hex(byte1)} {hex(byte2)} => 0x{char_code:04X} ({chr(char_code) if 0x20 <= char_code < 0xFFFF else '?'})")

        # 检查是否有冒号
        colon_positions = []
        for i in range(len(data)-1):
            byte1 = data[i]
            byte2 = data[i+1]
            char_code = byte2 << 8 | byte1

            # 全角冒号
            if char_code == 0xFF1A:
                colon_positions.append((i, '全角冒号', hex(char_code)))
            # 半角冒号
            elif byte1 == 0x3A and byte2 == 0x00:
                colon_positions.append((i, '半角冒号(UTF-16)', hex(char_code)))

        print(f"\n找到 {len(colon_positions)} 个冒号:")
        for pos, char_type, hex_code in colon_positions[:10]:
            print(f"  位置 {pos}: {char_type} - {hex_code}")

    else:
        print("未找到 '讯问时间'")

if __name__ == '__main__':
    check_doc_binary()
