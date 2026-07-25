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
    await window.waitForSelector("text=SierraStudio");
    await window.waitForSelector("text=打开一个 HTML 文件");
    console.log(await window.title());
    console.log("Electron smoke test passed");
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
