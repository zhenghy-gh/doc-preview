# doc-preview 持续优化循环 —— 协议与监督

> 本文件是**自动续跑循环的单一事实来源**。监督子智能体与定时任务都以本文件为准。
> 状态计数器在 `optimization-loop.json`（同目录）。轮次账本在仓库根的 `progress.md`。

## 目标

- **终止轮次：Round 1000**（用户 2026-10-13 更新目标：原 208，改为 1000）。
- 到达 1000 轮后**停止自动续跑**，做一次总结汇报，不再开启新轮。
- 每一轮必须**完整闭环**才计入 `completedRounds`：代码 + 护栏 + 验证 + 提交 + 双包发布。
- **发布暂停（用户 2026-10-19 指令）**：用户要求「npm 先不发布，继续做迭代」。暂停期间，一轮的闭环 = **代码 + 护栏 + 验证 + 提交**（跳过第 11/12 步的发布与 registry 核验），`completedRounds` 照常推进；`lastVersion` / `lastCommit` 指向本轮版本与提交。恢复发布时对**当时最新版本**做一次双包发布并补核验即可（npm 允许只发布比线上更高的版本）。
- **当前批次**：170 → 270（100 轮，每轮结束后**自动进入下一轮**，无需用户确认）。

## 每轮固定流程（不可跳步）

1. **选候选**：以 `--cpu-prof` 剖析 + 行级归因定位热点。候选必须**可测量**且**可证明等价**。
2. **隔离基准**：必须用**真实样本/真实流**复核，合成语料只能用来筛方向。
3. **护栏**：为采纳的改动写常驻差分/穷尽测试，并验证护栏**有鉴别力**（注入负控必须失败）。
4. **验证**：`npm test`（全量）+ `npx vue-tsc --noEmit` + `npm run lint` + `npm run build` + `npm run build:lib`。
5. **端到端**：独立进程、`git stash` 切源码、**交错 4×NEW / 4×OLD**，同会话对比取中位数（跨会话漂移约 4.4%，绝对值不可比）。
6. **逐字节核验**：27 份样本 `parse()` 结果落盘后 `cmp`，必须完全相同。
7. **bench-diff**：`node bench-diff.mjs <cycle>` 与上一轮 cycle 报告**逐字段相同**（除 `cycle`/`timestamp`）。
8. **记录**：`docs/changelog/YYYY-MM-DD-roundNN-optimization.md` + `progress.md` 追加 `## Round NN/100` + `.workbuddy-ai/memory/YYYY-MM-DD.md`。
9. **升号**：`npm version 0.7.NN --no-git-tag-version`（不建 tag）。
10. **提交**：`git commit`，工作区保持干净，一轮一提交。
11. **发布**：`npm run release`（脚本强制 `--registry=https://registry.npmjs.org`），双包 `@zhenghy/doc-preview` + `doc-preview`。
    **⚠ 暂停中**（见「目标」小节）：跳过本步与第 12 步，等用户恢复发布时对最新版本补做一次。
12. **核验发布**：`curl https://registry.npmjs.org/<pkg>` 查版本（registry 有传播延迟，scoped 包比 unscoped 慢，需 `sleep` 后重试）。**暂停期间跳过。**
13. **清理临时产物**：`.prof*` / `.bench*` / `.e2e-*` 必须删净（`eslint .` 会扫到它们）。
14. **更新状态**：把 `optimization-loop.json` 的 `completedRounds` / `currentRound` / `lastVersion` / `lastCommit` 前移。

## 硬纪律

- **候选在真实数据上实测退化 → 否决并撤回**，不得为了「凑一轮」而提交变慢的代码。
  历史案例：Round 107 段落格式共享上下文（真实慢 19–23%）、Round 108 `detectCharacterStyles`
  键比较去分配（慢 1.39x）——两者都**未落地任何生产代码**。
- **隔离基准赢 ≠ 端到端赢**（Round 103 函数级 1.47x / 端到端 −7%）。函数级只用来找方向，
  定值必须靠交错端到端。
- **不要并发跑 `npm test` 与 `npm run lint`**：eslint 会读到 vitest 的临时文件并报 ENOENT 假错误。
- 全量 `npm test` 约 2–4 分钟，建议后台运行。
- 本机 `~/.npmrc` 的 registry 是只读镜像，发布必须走 `npm run release`（脚本已强制官方源）。

## 监督子智能体职责

每轮结束后（或定时触发时）执行**只读审计**，不要改代码：

1. 统计 `progress.md` 里 `## Round N` 的最大 N，与 `docs/changelog/` 的文件数交叉核对。
2. 抽查最近 3 轮是否**五项齐全**：changelog 文件、progress 条目、memory 条目、`package.json` 版本递增、`git log` 提交。
3. 用 `curl https://registry.npmjs.org/@zhenghy%2Fdoc-preview` 与 `https://registry.npmjs.org/doc-preview`
   核对两个包的 `dist-tags.latest` 是否等于 `package.json` 的版本。
4. `git status --short` 是否干净（临时产物是否清理）。
5. 把结论写入 `optimization-loop.json` 的 `audit` 字段（`at` / `completedRounds` / `verdict` / `gaps`）。
6. 汇报格式：**一句话结论 + 缺口清单 + 下一轮编号**。若无缺口则只回一句话。

## 自动续跑规则

- 若 `completedRounds < 1000` 且**没有**正在进行的轮次 → 立即开启 `completedRounds + 1` 轮，走上面的固定流程。
- 若 `currentRound` 对应的轮次正在进行（状态文件里 `inFlight` 为真且 `updatedAt` 在 90 分钟内）→ 不开启新轮，只汇报。
- 若某轮验证失败或候选被否决 → **不发布**，把否决理由写进 changelog 与 memory，轮次仍可计入（历史上有「整轮全部否决」的先例）。
- 若 `completedRounds >= 1000` → 停止，输出总结。
