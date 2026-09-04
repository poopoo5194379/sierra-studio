const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { _electron: electron } = require("playwright");

(async () => {
  const htmlPath = process.argv[2];
  if (!htmlPath) throw new Error("Pass a Chart.js HTML file path");
  const projectRoot = path.join(__dirname, "..");
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-chartjs-"));
  const packagedExecutable = process.env.SIERRA_EXECUTABLE;
  const application = await electron.launch({
    executablePath: packagedExecutable
      ? path.resolve(packagedExecutable)
      : path.join(
        projectRoot,
        "node_modules",
        "electron",
        "dist",
        process.platform === "win32" ? "electron.exe" : "electron"
      ),
    args: [
      ...(packagedExecutable ? [] : [projectRoot]),
      `--user-data-dir=${userDataDirectory}`
    ],
    env: {
      ...process.env,
      APPDATA: userDataDirectory,
      SIERRASTUDIO_USER_DATA_DIR: userDataDirectory
    }
  });
  const errors = [];
  let phase = "launch";
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push({
      phase,
      message: error.message,
      stack: error.stack
    }));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push({
        phase,
        message: message.text()
      });
    });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(htmlPath));
    await window.locator(".empty-state").evaluate((element) => element.click());
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    phase = "ready";
    await window.keyboard.press("Escape");

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const canvas = frame.locator("canvas").first();
    await canvas.evaluate((element) => element.click());
    await window.locator(".chart-data-editor").waitFor({ timeout: 10_000 });
    phase = "selected";

    const editor = window.locator(".chart-data-editor");
    const data = JSON.parse(await editor.inputValue());
    const before = data.series[0].data[0];
    const pixelsBefore = await canvas.evaluate((element) => element.toDataURL());
    const requested = typeof before === "number" ? before + 7 : "updated";
    data.series[0].data[0] = requested;
    await editor.fill(JSON.stringify(data, null, 2));
    phase = "edited";
    await window.waitForTimeout(650);
    const liveAfterEdit = await canvas.evaluate((element) => {
      const chart = window.Chart.getChart(element);
      return chart?.data?.datasets?.[0]?.data?.[0];
    });
    const pixelsAfterEdit = await canvas.evaluate((element) => element.toDataURL());
    phase = "committed-while-focused";
    await window.waitForTimeout(500);

    const after = await canvas.evaluate((element) => {
      const chart = window.Chart.getChart(element);
      return chart?.data?.datasets?.[0]?.data?.[0];
    });
    phase = "shortcut-undo";
    await window.keyboard.press("Control+z");
    await window.waitForTimeout(650);
    const afterShortcutUndo = await canvas.evaluate((element) => {
      const chart = window.Chart.getChart(element);
      return chart?.data?.datasets?.[0]?.data?.[0];
    });
    const editorAfterShortcutUndo =
      JSON.parse(await editor.inputValue()).series[0].data[0];

    phase = "toolbar-redo";
    await window.getByRole("button", { name: "重做" }).evaluate(
      (element) => element.click()
    );
    await window.waitForTimeout(650);
    const afterToolbarRedo = await canvas.evaluate((element) => {
      const chart = window.Chart.getChart(element);
      return chart?.data?.datasets?.[0]?.data?.[0];
    });

    phase = "toolbar-undo";
    await window.getByRole("button", { name: "撤销" }).evaluate(
      (element) => element.click()
    );
    await window.waitForTimeout(650);
    const afterToolbarUndo = await canvas.evaluate((element) => {
      const chart = window.Chart.getChart(element);
      return chart?.data?.datasets?.[0]?.data?.[0];
    });
    console.log(JSON.stringify({
      before,
      requested,
      liveAfterEdit,
      after,
      afterShortcutUndo,
      editorAfterShortcutUndo,
      afterToolbarRedo,
      afterToolbarUndo,
      pixelsChanged: pixelsAfterEdit !== pixelsBefore,
      editorValue: JSON.parse(await editor.inputValue()).series[0].data[0],
      notice: await window.locator(".notice").textContent().catch(() => ""),
      errors
    }, null, 2));
    if (
      liveAfterEdit !== requested
      || after !== requested
      || afterShortcutUndo !== before
      || editorAfterShortcutUndo !== before
      || afterToolbarRedo !== requested
      || afterToolbarUndo !== before
      || pixelsAfterEdit === pixelsBefore
      || errors.length > 0
    ) process.exitCode = 1;
  } finally {
    await application.close();
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
