# 测试策略

## Rust（31 个单元测试）

| 模块 | 数量 | 覆盖 |
|------|------|------|
| `db.rs` | 16 | Block 切分（3）+ 提醒逻辑（11）+ 连续休息（1）+ 喝水记录（1） |
| `reminder.rs` | 4 | snooze / skip / 用户覆盖间隔 / 自动间隔过期 |
| `report.rs` | 4 | versionCode / target 映射 / 签名格式 / 签名规则一致性 |
| `water.rs` | 3 | snooze / 去重 / 喝水后清除 snooze |
| `media_audio.rs` | 4 | 排除列表过滤 / 全排除 / 无音频 / 文本解析 |

## 前端

使用 Playwright 进行自动化验证，直接连接已运行的 `pnpm tauri dev`（`http://localhost:1420`）或生产构建产物。

- 临时 / 探索性测试写在 `e2e-temp/`（已被 `.gitignore` 忽略）。
- 除非用户明确要求，否则不启动浏览器 preview/dev server；也不依赖手动点击验证。
- UI 断言优先用 DOM/截图，而不是截图后肉眼看。

## 运行

```bash
# Rust
cd src-tauri && cargo test

# Playwright 连接本地 dev server（需先启动 pnpm tauri dev）
pnpm exec playwright test e2e-temp/<your-spec>.ts --project=chromium
```
