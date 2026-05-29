# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Frontend dev server only (Vite, no Tauri shell)
pnpm tauri dev        # Full desktop app in development mode
pnpm tauri build      # Production build

cd src-tauri && cargo check   # Rust type check
cd src-tauri && cargo test    # Rust unit tests (14 tests in db.rs)
```

Package manager is **pnpm**.

## Documentation

详细架构、核心算法、测试覆盖、代码约定等请参考 [AGENTS.md](./AGENTS.md)。
