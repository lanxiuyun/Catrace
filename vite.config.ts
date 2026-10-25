import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // React 壳 + 共存期的 Vue 岛：两套插件同时启用，直到 M6 清场。
  plugins: [vue(), react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: [
        "**/src-tauri/**",
        // 插件源码不参与前端构建（宿主运行时按需读文件），必须整目录排除：
        // 编辑器/工具有序写入会在同目录建 `.xxx.tmpdir/` 临时文件再 rename，
        // Vite 的 fs.watch 撞上这个瞬间会 EBUSY，未捕获的 FSWatcher error 会直接打死 dev server，
        // 进而让 `pnpm tauri dev`（beforeDevCommand）一起退出。
        "**/tools/plugin-demo/**",
        "**/*.tmpdir/**",
        "**/*.tmpdir",
        // 一次性验证脚本目录（Playwright 临时件、量具脚本），同理不需要监视
        "**/e2e-temp/**",
      ],
    },
  },
}));
