const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error("Usage: node scripts/verify-import-file.cjs <html-path>");
}

const projectRoot = path.join(__dirname, "..");
const bundledElectronPath = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const executablePath = process.env.SIERRA_EXECUTABLE
  ? path.resolve(process.env.SIERRA_EXECUTABLE)
  : bundledElectronPath;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-import-"));

(async () => {
  const startedAt = Date.now();
  const errors = [];
  const application = await electron.launch({
    executablePath,
    args: [
      ...(process.env.SIERRA_EXECUTABLE ? [] : [projectRoot]),
      `--user-data-dir=${userDataDir}`
    ]
  });
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(sourcePath));

    await window.locator(".toolbar .toolbar-button").first().click();
    const expectedName = path.basename(sourcePath).replace(/\.html?$/i, "");
    await window.locator(".brand-copy small").getByText(expectedName, {
      exact: true
    }).waitFor({ timeout: 60_000 });
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator("body").waitFor({ timeout: 30_000 });
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    const modal = window.locator(".modal-backdrop");
    if (await modal.isVisible()) {
      const continueButton = modal.locator("button.primary");
      if (await continueButton.isVisible()) await continueButton.click();
    }
    const documentState = await frame.locator("html").evaluate(
      async (element) => {
        let runtimeMatrix = null;
        try {
          if (globalThis.__runtimeMatrixReady) {
            runtimeMatrix = await globalThis.__runtimeMatrixReady;
          }
        } catch (error) {
          runtimeMatrix = {
            error: error instanceof Error ? error.message : String(error)
          };
        }
        return {
          readyState: document.readyState,
          elements: element.querySelectorAll("*").length,
          textLength: element.textContent?.length ?? 0,
          scrollHeight: document.documentElement.scrollHeight,
          hasMuseumData: typeof globalThis.MuseumData === "object",
          hasMuseumApp: typeof globalThis.MuseumApp === "object",
          canvasCount: document.querySelectorAll("canvas").length,
          chartJsAvailable: typeof globalThis.Chart === "function",
          chartJsInstances:
            typeof globalThis.Chart?.instances === "object"
              ? Object.keys(globalThis.Chart.instances).length
              : 0,
          echartsAvailable: typeof globalThis.echarts === "object",
          echartsInstances:
            document.querySelectorAll("[_echarts_instance_]").length,
          runtimeMatrix
        };
      }
    );
    process.stdout.write(`${JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      documentState,
      errors
    }, null, 2)}\n`);
  } finally {
    await application.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
