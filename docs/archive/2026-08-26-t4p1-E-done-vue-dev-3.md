# 【T4-P1 E 块完工报告 · assets/documentAssets.ts move-only】（归档件）
> 署名 vue-dev-3 · 2026-08-26 13:00 CST · 归档说明：reviewer《e-block-findings》已出具「有条件通过——可放行 B 域」门禁结论并独立成档，本报告要点随之被吸收；E-F1/E-F2 整改见后续 B 块完工报告。原看板笔记按 R-1 落盘后腾位。

## 变更摘要
新建 src/utils/docparser/assets/documentAssets.ts(290行)：extractImages/extractPictures/extractProperties/extractDop 四方法 move-only 迁出（符号名锚、函数体逐字节保真）；私有静态 MAX_IMAGES 随域转公开导出；AssetExtractionContext{ole, maxScanBytes, readTableStream?} 注入原 this 依赖；scanLimitReached 实例标志随类保留。
docParser.ts 4150→3933 行：同签名薄委托×4、5 调用点零改动、孤儿导入修剪。
外部消费者零、无反向 import（契约 §2.2 规则2）。

## 红线实测
build ✅ / 58 文件 1287 用例全绿。

## 后续
B 域任务卡新增验收条件③：readTableStream 落地后收紧 AssetExtractionContext 为必选。
