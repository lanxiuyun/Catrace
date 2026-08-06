import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Vite launch-editor has no built-in trae mapping. Bare `trae` gets
// `trae <file> <line> <col>`, so Trae opens line/col as new files.
// Use a single .cmd path (not `node script.mjs`): on Windows launch-editor
// quotes the whole editor string, so multi-token commands fail with code 1.
const openInTrae = path
  .join(path.dirname(fileURLToPath(import.meta.url)), "scripts/open-in-trae.cmd")
  .replace(/\\/g, "/");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), vueDevTools({ launchEditor: openInTrae })],

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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
