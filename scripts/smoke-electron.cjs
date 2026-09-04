const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const executablePath = path.join(
    __dirname,
    "..",
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [path.join(__dirname, "..")]
  });
  try {
    const window = await application.firstWindow();
    await window.waitForSelector("text=Sierra Studio");
    await window.waitForSelector(".empty-state, .canvas-viewport-host");
    console.log(await window.title());
    console.log("Electron smoke test passed");
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
