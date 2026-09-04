const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const sourcePath = process.argv[2];
  const outputPath = process.argv[3];
  if (!sourcePath || !outputPath) {
    throw new Error("Pass an HTML path and an output PNG path");
  }
  const projectRoot = path.join(__dirname, "..");
  const executablePath = path.join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [projectRoot]
  });
  try {
    await application.evaluate(async ({ BrowserWindow }, selectedPath) => {
      const captureWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        show: true,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      global.__sierraCaptureWindow = captureWindow;
      await captureWindow.loadFile(selectedPath);
    }, path.resolve(sourcePath));
    const windows = application.windows();
    const page = windows[windows.length - 1];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForTimeout(1500);
    const requestedSlide = Number(process.argv[4]);
    if (Number.isInteger(requestedSlide) && requestedSlide > 0) {
      const slide = page.locator(".slide").nth(requestedSlide - 1);
      await slide.scrollIntoViewIfNeeded();
      await slide.screenshot({
        path: path.resolve(outputPath),
        animations: "disabled"
      });
      console.log(JSON.stringify({
        outputPath: path.resolve(outputPath),
        slide: requestedSlide,
        errors
      }, null, 2));
      return;
    }
    if (process.argv[4] === "print") {
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(500);
      const diagnostics = await page.evaluate(() => ({
        scrollY,
        fixed: [...document.querySelectorAll("*")]
          .filter((element) => ["fixed", "sticky"].includes(getComputedStyle(element).position))
          .slice(0, 30)
          .map((element) => ({
            tag: element.tagName,
            id: element.id,
            className: element.className,
            position: getComputedStyle(element).position,
            rect: element.getBoundingClientRect().toJSON()
          })),
        canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({
          id: canvas.id,
          parent: canvas.parentElement?.id || canvas.parentElement?.className,
          rect: canvas.getBoundingClientRect().toJSON()
        })),
        percentLabels: [...document.querySelectorAll("*")]
          .filter((element) =>
            element.childElementCount === 0
            && /^\d+(?:\.\d+)?%$/.test(element.textContent?.trim() || "")
          )
          .slice(0, 100)
          .map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim(),
            id: element.id,
            className: element.className,
            position: getComputedStyle(element).position,
            rect: element.getBoundingClientRect().toJSON()
          }))
      }));
      console.log(JSON.stringify({ diagnostics }, null, 2));
    }
    await page.screenshot({
      path: path.resolve(outputPath),
      fullPage: false,
      animations: "disabled"
    });
    console.log(JSON.stringify({ outputPath: path.resolve(outputPath), errors }, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
