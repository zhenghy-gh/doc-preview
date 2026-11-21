# 2026-11-21 · 任务 A：errorCode 结构化错误码全链路透传

## 背景

`ParseResult.errorCode`（ERR-CODE）是为根治「中文自由文案分类漏判落 unknown」引入的
机器可读错误码；`errorClassifier` 中的 `PARSE_ERROR_CATEGORY` 直映射把它作为最高优先级。
但审查发现该直映射在运行时是**死路径**：错误码从未到达 `ErrorDisplay`。

## 三处断点（负控先行证实）

先写 `tests/errorCodePassthrough.test.ts`（5 项），用 raw 文案按关键字会落到**别的类别**的
样例构造失败，证明只有 code 真透传才得到结构化标题。修复前 5 项中 **4 项失败**：

1. **`docParser.worker.ts`** 的 `result` 消息只 post `success/document/text/error`，不 post
   `errorCode` ⇒ 大文件走 worker 路径时错误码在消息边界丢失（`parseWithWorker.ts` 本身已有
   `errorCode: msg.errorCode` 转发，是消息源头没带）。
2. **`DocPreview.vue`** 的本地 `ParserOutput` 接口无 `errorCode`、`error` ref 旁无对应状态，
   失败分支只写 `error.value = result.error`，template 也只传 `:error="error"` ⇒ UI 链路丢失。
3. **`ErrorDisplay.vue`** 只声明 `error: string` prop，调用 `classifyError` 时不传第三参数。

附带类型缺口：`parseDocFileFromBuffer` 的声明返回类型不含 `errorCode`（虽运行时原样返回
`parseWithFormat()` 的结果），使 URL 加载路径访问 `result.errorCode` 类型不通过。

## 修复

- worker 结果消息新增 `errorCode: result.errorCode`，协议向后兼容（旧消息无该字段 ⇒
  `parseWithWorker` 收到 `undefined`，回退关键字分类）。
- `parseDocFileFromBuffer` 返回类型补 `errorCode?: ParseErrorCode`。
- `DocPreview`：新增 `errorCode` ref，随各失败/清空分支与 `error` 同步设置（结构化失败取
  `result.errorCode`，异常/超时/空文档等无 code 场景清空回退）；`ParserOutput` 补字段；
  `ErrorDisplay` 调用加 `:error-code="errorCode"`。
- `ErrorDisplay`：新增可选 `errorCode` prop 并透传给 `classifyError`。

## 验证

- 新测试修复前 4/5 失败、修复后 5/5 通过；关键字回退兼容用例前后均通过。
- 全量门禁：`vue-tsc --noEmit` 0；`npm test` 120 文件 / 2072 项（+1 文件 / +5 项）；
  `lint` 0；app/lib 双构建通过；`scan:corpus` 27/27；`printPageAudit --check` OK。
