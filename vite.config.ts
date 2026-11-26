import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), flattenDevColorMixSupports()],

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
        // 编辑器/工具有序写入会在同目录建 `.xxx.tmpdir/` 临时文件再 rename，
        // Vite 的 fs.watch 撞上这个瞬间会 EBUSY，未捕获的 FSWatcher error 会直接打死 dev server，
        // 进而让 `pnpm tauri dev`（beforeDevCommand）一起退出。
        "**/*.tmpdir/**",
        "**/*.tmpdir",
        // 一次性验证脚本目录（Playwright 临时件、量具脚本），同理不需要监视
        "**/e2e-temp/**",
      ],
    },
  },
}));

const COLOR_MIX_SUPPORTS = /@supports\s*\(color:\s*color-mix\(in lab,\s*red,\s*red\)\)\s*\{/g;

/**
 * HeroUI/Tailwind emits one identical color-mix @supports block for almost every
 * color rule. DevTools' Elements panel walks every @supports when selecting a node;
 * with ~90 of them a click stalls the inspector for ~200ms. The dev WebView already
 * supports color-mix, so flatten only this wrapper in dev. Production keeps the
 * fallback blocks for older WebViews.
 *
 * Must stay after tailwindcss() (also `enforce: "pre"`) so it sees generated CSS.
 */
function flattenDevColorMixSupports(): Plugin {
  return {
    name: "catrace:flatten-dev-color-mix-supports",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(".css") || !code.includes("color-mix(in lab, red, red)")) return null;
      return { code: flattenColorMixSupports(code), map: null };
    },
  };
}

function flattenColorMixSupports(css: string): string {
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  COLOR_MIX_SUPPORTS.lastIndex = 0;

  while ((match = COLOR_MIX_SUPPORTS.exec(css))) {
    out += css.slice(last, match.index);
    const open = match.index + match[0].length - 1;
    let depth = 1;
    let cursor = open + 1;
    let quote = "";

    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (quote) {
        if (char === "\\") cursor += 2;
        else {
          if (char === quote) quote = "";
          cursor++;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        cursor++;
        continue;
      }
      if (char === "/" && css[cursor + 1] === "*") {
        const end = css.indexOf("*/", cursor + 2);
        cursor = end < 0 ? css.length : end + 2;
        continue;
      }
      if (char === "{") depth++;
      else if (char === "}") depth--;
      cursor++;
    }

    const close = depth === 0 ? cursor - 1 : cursor;
    out += css.slice(open + 1, close);
    last = cursor;
    COLOR_MIX_SUPPORTS.lastIndex = cursor;
  }

  return out + css.slice(last);
}
