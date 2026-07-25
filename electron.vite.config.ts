import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@domain": resolve("src/domain"),
        "@application": resolve("src/application"),
        "@infrastructure": resolve("src/infrastructure"),
        "@shared": resolve("src/shared")
      }
    }
    // NOTE: V8 bytecode disabled — bytecode-loader (require+vm) fails in
    // the packaged Electron runtime. The main process code is bundled inside
    // app.asar (with ASAR integrity enabled), which provides adequate
    // protection for the open-source edition.
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
    // IMPORTANT: Preload runs in a context-isolated sandbox.
    // It cannot use Node.js require/vm to load .jsc bytecode.
    // Keep it as plain .js (only ~2KB anyway).
  },
  renderer: {
    server: {
      // The editing iframe intentionally has an opaque (`null`) origin because
      // it is sandboxed without allow-same-origin. Its editor runtime is loaded
      // from Vite during development, so every runtime module needs CORS headers.
      cors: true
    },
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          "editor-runtime": resolve("src/editor-runtime/index.ts")
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === "editor-runtime"
              ? "editor-runtime.js"
              : "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  }
});
