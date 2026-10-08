# 七败清零完工 · T4-P1 收官门槛达成 · vue-dev-6 · 2026-08-26 21:2x CST

## 任务
leader 正式改派（captain v80）：按复核报告三簇定位表独立清零七败，无需等待 pad 移交；1287 用例=最终裁判。纪律：SNAPSHOT-FIRST/parking/30min 检查点/卡壳即报——全部遵守（快照 docs/wip-parking/t4p1-A/pre-seven-fix-snapshot/）。

## 终态红线实测（全绿四连）
- **npm run build ✅ vue-tsc 0 错误** + vite 0.74s（main 315.58KB/gzip107.54）
- **npm test ✅ 58 文件 / 1287 用例全绿**
- **renderGolden ✅ 11/11 零漂移**；realDocs 同批通过
- `vue-tsc --noEmit` 独立复核 = **0 错误**

## 三簇修复明细
### 簇1 ENC-04 跨编码重试回归（×2→0）
根因：writer 重写 extractTextWithAutoDetect 时丢失重试块——binaryDetect 非 null 即早返回，误判臂无推翻机会。
修复：模块重构三段式——`extractRawParagraphs`（原始段收集体）/ `filterRawParagraphs`（C 块过滤管线）/ 组合式 extractTextSimple（对外签名不变）；autoDetect 恢复「选中臂→shouldTryCrossEncodingRetry→对侧臂→crossEncodingRetryWins(原始段评分择优)」完整链路。null 分支评分回退原样保留（sparse-NUL 双极性用例继续绿）。

### 簇2 ERR-CODE 结构化错误码（×3→0）
ParseResult.errorCode 类型域本就存在（docFormat ParseErrorCode 含 OLE_FORMAT/EMPTY_DOCUMENT）。补齐：parseWithFormat 返回类型注解 + 两失败出口赋值（OLE_FORMAT @isOleFile 守卫 / EMPTY_DOCUMENT @空文档兜底）+ parseDocFileWithFormat wrapper 签名宽化 + worker 幽灵字段正式恢复传递。classifyError 按 code 优先判定已就绪（其 3 用例先期绿）。

### 簇3 FIELD-CP-GOV 接线缺口（×1→0）
normalizeParagraphCpAxis 定义在而调用点零——咽喉归一化未接线。补接于 parseWithFormat 主装配点（document 组装前对 extracted.paragraphs 归一化），单轴不变式端到端成立。

### 附带修复（同窗顺带）
- parseWithFormat 无流兜底分支 document 装配滑落复原（ENC-04 前两败的 document=undefined 根因）
- hyperlinks 断言桥接复原（TD-1a 在案先例）
- textHeuristics 五符号导入恢复、formatRecovery 死导入解耦、worker 幽灵字段清理

## 过程记录（诚实披露）
- 本任务期间与 vue-dev-3 发生两次活体写盘碰撞（20:06-20:35 三波落盘）；leader 两次裁决均正确引导（R432 撤单 / 选 B 监视哨）。其收敛吸收了我方 19 处同向修复，终态殊途同归。
- 中途"7 败"复现为写盘竞态采样假象——静默后以真实夹具隔离复测定性，避免了误修。
- 快照回滚零次启用（未需要）；30 分钟检查点 ×2 均正常推进。

## 验收链路状态
全树全绿 ⇒ D2 解除条件达成 ⇒ 待 reviewer 终审 + 稳定检查点复跑 ⇒ T4-P1 收官宣告。
