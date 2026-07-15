import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const classicScriptEntries = [
  "background.js",
  "content.js",
  "pagePlaybackBridge.js",
];

function assertClassicScriptEntries() {
  return {
    name: "assert-classic-extension-entries",
    closeBundle() {
      for (const entry of classicScriptEntries) {
        const source = readFileSync(resolve(__dirname, "dist", entry), "utf8");
        if (/^\s*(?:import|export)(?:[\s{*]|["'])/m.test(source)) {
          throw new Error(
            `${entry} contains an ES module statement but Chrome loads it as a classic script.`
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [assertClassicScriptEntries()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
        pagePlaybackBridge: resolve(__dirname, "src/pagePlaybackBridge.ts"),
        popup: resolve(__dirname, "popup/index.html"),
        overlay: resolve(__dirname, "overlay/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
