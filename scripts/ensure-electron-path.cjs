const fs = require("node:fs");
const path = require("node:path");

// Electron ships its platform binary through a separate postinstall step
// (`electron`'s own install script). npm does not guarantee that this project's
// postinstall runs after the dependency's, so on a completely clean checkout the
// binary may legitimately not be there yet -- most notably on CI runners.
//
// Throwing here made `npm ci` fail on every fresh environment (the macOS build
// died before it ever reached the packaging step). We instead warn and let the
// install finish; the build commands verify the binary themselves and fail with
// a message that actually explains what to do.

const electronRoot = path.dirname(require.resolve("electron/package.json"));

const executable = process.platform === "win32"
  ? "electron.exe"
  : process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : "electron";

const executablePath = path.join(electronRoot, "dist", executable);

if (!fs.existsSync(executablePath)) {
  console.warn(
    "[electron-path] Electron binary not present yet at\n"
    + `  ${executablePath}\n`
    + "Skipping path.txt. This is expected during a fresh `npm install` / `npm ci`\n"
    + "run before the electron package finishes downloading its binary. If a build\n"
    + "later reports a missing Electron binary, run `npm rebuild electron` or\n"
    + "`node node_modules/electron/install.js` to fetch it."
  );
  process.exit(0);
}

// Electron's launcher intentionally does not trim this file.
fs.writeFileSync(path.join(electronRoot, "path.txt"), executable);
