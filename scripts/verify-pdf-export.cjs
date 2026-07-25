const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { PDFDocument } = require("pdf-lib");

(async () => {
  const projectRoot = path.join(__dirname, "..");
  const htmlPath = process.argv[2] || path.join(projectRoot, "examples", "demo.html");
  const requestedMode = process.argv[3] || "both";
  const outputDirectory = path.join(projectRoot, "tmp", "pdfs");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const smartPath = path.join(outputDirectory, "sierra-smart.pdf");
  const longPath = path.join(outputDirectory, "sierra-long.pdf");
  const executablePath = path.join(
    projectRoot, "node_modules", "electron", "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [projectRoot]
  });
  application.process().stdout?.on("data", (chunk) => {
    process.stdout.write(`[electron] ${chunk}`);
  });
  application.process().stderr?.on("data", (chunk) => {
    process.stderr.write(`[electron] ${chunk}`);
  });
  const errors = [];
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.html]
      });
      dialog.showSaveDialog = async (options) => ({
        canceled: false,
        filePath: String(options.defaultPath).includes("智能分页")
          ? paths.smart
          : paths.long
      });
    }, {
      html: path.resolve(htmlPath),
      smart: smartPath,
      long: longPath
    });

    await window.locator(".empty-state").click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 120_000 });

    const exportMode = async (mode) => {
      await window.getByRole("button", { name: "导出 PDF" }).click();
      await window.getByRole("button", {
        name: mode === "smart" ? /智能分页 PDF/ : /一整页 PDF/
      }).click();
      await window.getByRole("button", { name: "选择位置并导出" }).click();
      await window.getByText(/PDF (已导出|导出失败)/).waitFor({
        timeout: 360_000
      });
      const status = await window.locator(".statusbar").innerText();
      if (status.includes("失败")) throw new Error(status);
    };

    if (requestedMode !== "long") await exportMode("smart");
    if (requestedMode !== "smart") await exportMode("long");

    const result = { errors };
    if (requestedMode !== "long") {
      const smart = await PDFDocument.load(fs.readFileSync(smartPath));
      Object.assign(result, {
        smartPath,
        smartPages: smart.getPageCount(),
        smartSizes: smart.getPages().map((page) => [
          Math.round(page.getWidth()),
          Math.round(page.getHeight())
        ])
      });
    }
    if (requestedMode !== "smart") {
      const long = await PDFDocument.load(fs.readFileSync(longPath));
      Object.assign(result, {
        longPath,
        longPages: long.getPageCount(),
        longSize: [
          Math.round(long.getPage(0).getWidth()),
          Math.round(long.getPage(0).getHeight())
        ]
      });
    }
    console.log(JSON.stringify(result, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
