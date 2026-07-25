const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const executablePath = path.join(
    __dirname, "..", "node_modules", "electron", "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [path.join(__dirname, "..")]
  });
  try {
    const window = await application.firstWindow();
    const errors = [];
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const bridgeType = await window.evaluate(() => typeof window.sierraStudio);
    const demoPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.join(__dirname, "..", "examples", "demo.html");
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, demoPath);
    await window.locator(".empty-state").click();
    await window.getByText("index.html").waitFor({ timeout: 120_000 });
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator("body").waitFor({ timeout: 120_000 });
    console.log(JSON.stringify({
      bridgeType,
      imported: true,
      canvasTextLength: (await frame.locator("body").innerText()).length,
      errors
    }, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
