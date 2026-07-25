const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const htmlPath = process.argv[2];
  if (!htmlPath) throw new Error("Pass a chart HTML file path");
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
  const errors = [];
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(htmlPath));
    await window.locator(".empty-state").click();
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    try {
      await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    } catch (error) {
      const diagnostics = {
        runtimeClass: await window.locator(".runtime-state").getAttribute("class"),
        runtimeText: await window.locator(".runtime-state").textContent(),
        iframe: await frame.locator("html").evaluate(() => ({
          readyState: document.readyState,
          scripts: [...document.scripts].map((script) => ({
            src: script.src,
            type: script.type,
            user: script.hasAttribute("data-hs-user-script")
          })),
          echarts: typeof window.echarts,
          canvases: document.querySelectorAll("canvas").length
        })).catch((reason) => ({ error: String(reason) })),
        errors
      };
      console.error(JSON.stringify({ diagnostics }, null, 2));
      throw error;
    }

    const chartState = await frame.locator("html").evaluate(() => {
      const echartsElements = [...document.querySelectorAll("[_echarts_instance_]")];
      const chartInstances = window.Chart?.instances;
      const chartJsCount = chartInstances instanceof Map
        ? chartInstances.size
        : Object.keys(chartInstances || {}).length;
      return {
        echartsCount: echartsElements.length,
        chartJsCount,
        canvases: document.querySelectorAll("canvas").length,
        paintedCanvases: [...document.querySelectorAll("canvas")].filter((canvas) => {
          try { return canvas.toDataURL().length > 1000; }
          catch { return false; }
        }).length
      };
    });
    if (chartState.echartsCount + chartState.chartJsCount === 0) {
      throw new Error(`No chart instances discovered: ${JSON.stringify(chartState)}`);
    }

    const chart = frame.locator("[_echarts_instance_]").first();
    await chart.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    });
    await window.waitForTimeout(150);
    const inner = await chart.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        id: element.getAttribute("data-hs-id"),
        domId: element.id
      };
    });
    const iframe = await window.locator('iframe[title="HTML editing canvas"]').evaluate(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          viewportWidth: element.clientWidth,
          viewportHeight: element.clientHeight
        };
      }
    );
    await window.mouse.click(
      iframe.x + (inner.x + inner.width / 2) * (iframe.width / iframe.viewportWidth),
      iframe.y + (inner.y + inner.height / 2) * (iframe.height / iframe.viewportHeight)
    );
    await window.locator(".chart-editor").waitFor();

    const titleInput = window.locator(".chart-editor input").first();
    const originalTitle = await titleInput.inputValue();
    const updatedTitle = "SierraStudio 实时图表";
    await titleInput.fill(updatedTitle);
    await window.locator(".chart-editor-heading").click();
    await window.waitForTimeout(350);
    const titleAfterEdit = await chart.evaluate((element) =>
      window.echarts.getInstanceByDom(element).getOption().title?.[0]?.text ?? ""
    );

    const dataEditor = window.locator(".chart-data-editor");
    const data = JSON.parse(await dataEditor.inputValue());
    const originalDataPoint = data.series?.[0]?.data?.[0];
    const updatedDataPoint = typeof originalDataPoint === "number"
      ? originalDataPoint + 1
      : "SierraStudio";
    data.series[0].data[0] = updatedDataPoint;
    await dataEditor.fill(JSON.stringify(data, null, 2));
    await window.locator(".chart-editor-heading").click();
    await window.waitForTimeout(350);
    const dataAfterEdit = await chart.evaluate((element) =>
      window.echarts.getInstanceByDom(element).getOption().series?.[0]?.data?.[0]
    );

    await window.getByText("撤销", { exact: true }).click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    await window.waitForTimeout(350);
    const chartAfterDataUndo = frame.locator("[_echarts_instance_]").first();
    const dataAfterUndo = await chartAfterDataUndo.evaluate((element) =>
      window.echarts.getInstanceByDom(element).getOption().series?.[0]?.data?.[0]
    );

    await window.getByText("撤销", { exact: true }).click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    const chartAfterUndo = frame.locator("[_echarts_instance_]").first();
    await window.waitForTimeout(350);
    const titleAfterUndo = await chartAfterUndo.evaluate((element) =>
      window.echarts.getInstanceByDom(element).getOption().title?.[0]?.text ?? ""
    );

    await window.getByText("重做", { exact: true }).click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    await window.waitForTimeout(350);
    await window.getByText("重做", { exact: true }).click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    const chartAfterRedo = frame.locator("[_echarts_instance_]").first();
    await window.waitForTimeout(500);
    const redoState = await chartAfterRedo.evaluate((element) => ({
      title: window.echarts.getInstanceByDom(element).getOption().title?.[0]?.text ?? "",
      manifest: document.querySelector("[data-hs-chart-manifest]")?.textContent ?? ""
    }));

    console.log(JSON.stringify({
      chartState,
      originalTitle,
      updatedTitle,
      titleAfterEdit,
      originalDataPoint,
      updatedDataPoint,
      dataAfterEdit,
      dataAfterUndo,
      titleAfterUndo,
      redoState,
      errors
    }, null, 2));
    if (
      titleAfterEdit !== updatedTitle
      || dataAfterEdit !== updatedDataPoint
      || dataAfterUndo !== originalDataPoint
      || titleAfterUndo !== originalTitle
      || redoState.title !== updatedTitle
      || !redoState.manifest
      || errors.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
