const fs = require("node:fs");
const path = require("node:path");

const electronRoot = path.dirname(require.resolve("electron/package.json"));
const executable = process.platform === "win32"
  ? "electron.exe"
  : process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : "electron";
const executablePath = path.join(electronRoot, "dist", executable);

if (!fs.existsSync(executablePath)) {
  throw new Error(`Electron binary is missing at ${executablePath}`);
}

// Electron's launcher intentionally does not trim this file.
fs.writeFileSync(path.join(electronRoot, "path.txt"), executable);
