// Post-build: copy a thin package.json to win-unpacked root
// electron-builder sometimes skips this when --config.electronDist is used.
// This ensures the unpacked app is recognized by Electron.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UNPACKED = path.join(ROOT, "release", "win-unpacked");
const TARGET = path.join(UNPACKED, "package.json");

if (!fs.existsSync(UNPACKED)) {
  console.log("[post-build] No win-unpacked at " + UNPACKED);
  process.exit(0);
}

if (!fs.existsSync(path.join(UNPACKED, "SierraStudio.exe"))) {
  console.log("[post-build] No SierraStudio.exe in " + UNPACKED);
  process.exit(0);
}

const thin = {
  name: "sierra-studio",
  productName: "SierraStudio",
  version: "0.1.0",
  main: "./resources/app.asar"
};

fs.writeFileSync(TARGET, JSON.stringify(thin, null, 2));
console.log("[post-build] ✓ Wrote thin package.json to " + TARGET);
