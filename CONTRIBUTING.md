# 参与贡献

感谢你对 Catrace 的关注！无论你是修复 Bug、改进文档，还是添加新功能，我们都欢迎你的参与。

[English](#english) | [中文](#中文)

---

## 中文

### 开始之前

Catrace 是一款基于 **Tauri 2 + Vue 3 + Rust** 的跨平台桌面应用，目标平台为 **Windows / macOS / Linux**。参与贡献前，建议先阅读：

- [README.md](./README.md) — 产品功能与隐私说明
- [AGENTS.md](./AGENTS.md) — 架构、核心算法与开发约定（面向维护者/AI 助手，内容详尽）

### 环境要求

| 工具 | 说明 |
|------|------|
| [Node.js](https://nodejs.org/) | LTS 版本 |
| [pnpm](https://pnpm.io/) | 包管理器（项目使用 pnpm，勿用 npm/yarn） |
| [Rust](https://www.rust-lang.org/tools/install) | stable 工具链 |
| [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/) | 按你的操作系统安装 WebView 等依赖 |

**平台权限说明**（本地开发时可能需要）：

- **macOS**：键鼠监听需要「辅助功能」权限
- **Windows**：部分通知能力依赖系统 Toast API

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/lanxiuyun/Catrace.git
cd Catrace

# 安装前端依赖
pnpm install

# 完整桌面应用开发模式（推荐）
pnpm tauri dev
```

生产构建：

```bash
pnpm tauri build
```

### 如何参与

#### 报告问题

在提交 Issue 前，请先搜索 [已有 Issue](https://github.com/lanxiuyun/Catrace/issues)，避免重复。

提交 Bug 时，请尽量包含：

- 操作系统与版本（如 Windows 11、macOS 14）
- Catrace 版本号
- 复现步骤与预期/实际行为
- 相关截图或日志（如有）

功能建议同样欢迎在 Issue 中讨论，便于在实现前对齐需求。

#### 提交 Pull Request

1. **Fork** 本仓库，从你的 Fork 创建分支（分支名建议：`fix/xxx`、`feat/xxx`、`docs/xxx`）。
2. 在 **`main`** 分支基础上开发（日常贡献合并目标为 `main`）。
3. 保持 PR **聚焦**：一次 PR 解决一个问题，避免无关改动。
4. 若改动涉及 UI 或行为，请在 PR 描述中说明测试方式与平台。
5. 若改动 Rust 提醒/切分逻辑，请运行 `cargo test` 并确保现有测试通过；必要时补充单元测试。
6. 若新增或修改用户可见文案，请同时更新 **`zh-CN`** 与 **`en-US`** 翻译（`src/i18n/locales/`）。

维护者会在 Review 后合并。如有疑问，可在 PR 中 @ 维护者或于 Issue 讨论。

### 代码规范

- **文档与注释**：项目文档使用中文；代码注释与现有风格保持一致。
- **前端**：Vue 3 Composition API + `<script setup>` + TypeScript；UI 配色统一维护在 `src/theme.ts`。
- **Rust**：业务逻辑主要在 `src-tauri/src/lib.rs`、`db.rs`、`reminder.rs`；扩展时优先复用现有模块，避免重复实现。
- **跨平台（强约束）**：
  - 新增系统 API、原生依赖、文件路径、通知、托盘等功能时，**必须先评估** Windows / macOS / Linux 兼容性。
  - 平台专属 crate（如 `tauri-winrt-notification`、`windows-registry`）须在 `Cargo.toml` 中按 `target.'cfg(...)'.dependencies` 声明，代码中用 `#[cfg(target_os = "...")]` 隔离。
  - 其他平台需提供等效实现或优雅降级，禁止在公共路径硬编码单平台 API。

### 测试

| 层级 | 说明 |
|------|------|
| Rust | `cd src-tauri && cargo test` — 覆盖 block 切分、提醒判定、状态机等（见 [AGENTS.md](./AGENTS.md#测试策略)） |
| 前端 | 暂无自动化测试；UI 改动请用 `pnpm tauri dev` 手动验证 |
| 跨平台 | 若改动 Rust 后端或系统交互，请在你能访问的平台上实测 |

### 分支与发布

| 分支 | 用途 |
|------|------|
| `main` | 日常开发与 PR 合并目标 |
| `release` | 触发 [GitHub Actions 发布流程](.github/workflows/release.yml)，构建多平台安装包并创建 GitHub Release |

版本发布由维护者操作，贡献者通常只需向 `main` 提交 PR。

### 行为准则

请保持友善、尊重与建设性的交流。骚扰、歧视、人身攻击或恶意行为不被接受，维护者有权拒绝相关贡献。

---

## English

### Before You Start

Catrace is a cross-platform desktop app built with **Tauri 2 + Vue 3 + Rust**, targeting **Windows, macOS, and Linux**. Recommended reading:

- [README_EN.md](./README_EN.md) — Features and privacy
- [AGENTS.md](./AGENTS.md) — Architecture and conventions (detailed, mainly for maintainers)

### Prerequisites

| Tool | Notes |
|------|-------|
| [Node.js](https://nodejs.org/) | LTS |
| [pnpm](https://pnpm.io/) | Required package manager |
| [Rust](https://www.rust-lang.org/tools/install) | stable toolchain |
| [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) | OS-specific WebView deps |

### Local Development

```bash
git clone https://github.com/lanxiuyun/Catrace.git
cd Catrace
pnpm install
pnpm tauri dev          # full app
cd src-tauri && cargo test
```

### Contributing

- **Issues**: Search [existing issues](https://github.com/lanxiuyun/Catrace/issues) first. Include OS, app version, steps to reproduce, and expected vs actual behavior.
- **Pull requests**: Branch from `main`, keep changes focused, run `cargo test` for Rust logic changes, update both `zh-CN` and `en-US` locales for user-facing strings.
- **Cross-platform**: Isolate platform-specific code with `#[cfg(target_os = ...)]` and provide fallbacks on other platforms.
- **Version bumps**: Only when requested; sync `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` per [docs/version-management.md](./docs/version-management.md).

### Branches

- `main` — development and PR target
- `release` — CI release builds (maintainer-driven)

### Privacy

Do not log key contents, mouse coordinates, or screen data. Do not add unnecessary network calls or tracking.

### Code of Conduct

Be respectful and constructive. Harassment or abuse is not tolerated.

---

再次感谢你的贡献！
