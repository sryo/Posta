import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Node global; @types/node is not a dependency.
declare const process: { env: Record<string, string | undefined> };

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [solid()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Vite's default targets Safari 16.4; macOS 10.15, the oldest the bundle
  // supports, runs at most Safari 15.6, which cannot parse some of that output.
  build: {
    target: "safari15",
  },
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
});
