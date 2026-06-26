# CLAUDE.md — ClipSync 项目指引

## 项目简介

ClipSync 是一个局域网跨设备同步工具，在 Windows、iPadOS、HarmonyOS 之间实时同步文字、图片和文件。

- **项目路径**: `G:\OneDrive\Claude Code项目\同步程序\`
- **当前阶段**: v1.0 开发中（Windows Electron 桌面应用）
- **目标用户**: 编程小白，所有操作需简单直观

---

## 标准文档索引

在开始任何开发任务前，必须阅读相关标准文档：

| 文档 | 路径 | 何时查阅 |
|------|------|----------|
| 需求规格 | [docs/requirements.md](docs/requirements.md) | 不确定功能边界时 |
| 技术架构 | [docs/architecture.md](docs/architecture.md) | 修改架构/新增模块时 |
| UI 设计规范 | [docs/design-spec.md](docs/design-spec.md) | 修改界面时（颜色、布局、组件） |
| API 接口规范 | [docs/api-spec.md](docs/api-spec.md) | 修改/新增 API 时 |
| 数据模型 | [docs/data-model.md](docs/data-model.md) | 修改数据结构时 |
| 开发步骤追踪 | [docs/dev-steps.md](docs/dev-steps.md) | 每次开发前查看当前进度 |
| 变更记录 | [docs/changelog.md](docs/changelog.md) | 每次修改后更新 |
| 总体计划 | `C:\Users\xuyao\.claude\plans\windows-ipados-wifi-24-ui-rosy-dove.md` | 需要回顾全局规划时 |

---

## 工作规范

### 必须遵守的规则

1. **逐步推进** — 严格按 [docs/dev-steps.md](docs/dev-steps.md) 中的步骤顺序执行，不得跳步
2. **每步验证** — 完成一个子任务后必须验证功能正常，再进入下一步
3. **不猜测需求** — 任何不明确的功能细节，先问用户确认，不做假设
4. **保持简洁** — 不过度设计，不引入不必要的依赖
5. **匹配现有风格** — 新代码风格与已有代码保持一致

### 开发日志

- **每次开发会话开始时**：创建/检查 `devlog/YYYY-MM-DD.md`
- **每次开发会话结束时**：更新日志，记录完成事项和待办
- 日志格式：
  ```markdown
  # 开发日志 YYYY-MM-DD
  
  ## 完成事项
  - [x] 事项 1
  - [x] 事项 2
  
  ## 遇到的问题
  - 问题描述及解决方案
  
  ## 待办事项
  - [ ] 下一步待办 1
  - [ ] 下一步待办 2
  
  ## 下一步计划
  简要描述
  ```

### 代码规范

- JavaScript：ES6+ 语法，单引号，分号结尾
- 命名：camelCase（变量/函数），kebab-case（文件/CSS 类名）
- 注释：关键逻辑必须有中文注释（用户可能需要理解）
- 缩进：2 空格
- 编码：UTF-8

### 提交与验证

- 不要在未确认用户意图的情况下修改文件
- 验证方式：启动应用实际测试（通过 `npm start` 或直接运行）
- 测试通过标准：功能可用、无报错、UI 符合设计规范

---

## 技术栈速查

| 技术 | 用途 |
|------|------|
| Electron 28+ | Windows 桌面应用框架 |
| Express 4.x | HTTP 服务器 |
| ws 8.x | WebSocket 实时通信 |
| bonjour 3.x | mDNS 局域网设备发现 |
| better-sqlite3 9.x | 本地 SQLite 数据库 |
| electron-builder 24.x | 打包为 .exe |
| uuid 9.x | 生成唯一 ID |
| 原生 HTML/CSS/JS | 前端界面（零框架） |

---

## 项目目录结构

```
同步程序/
├── CLAUDE.md              # 本文件
├── docs/                  # 标准文档
│   ├── requirements.md
│   ├── architecture.md
│   ├── design-spec.md
│   ├── api-spec.md
│   ├── data-model.md
│   ├── dev-steps.md
│   └── changelog.md
├── devlog/                # 开发日志
├── src/                   # 源代码
│   ├── main/              # Electron 主进程
│   ├── server/            # HTTP + WebSocket
│   ├── web/               # 前端界面
│   └── database/          # 数据库
├── data/                  # 运行时数据
└── package.json
```


# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.