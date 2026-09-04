const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Pass the imported HTML file path");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-svg-chart-"));
const executablePath = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const checks = [];

function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function saveRenderedChart(window, locator, name) {
  await window.waitForTimeout(900);
  const data = await locator.locator("canvas").evaluate((canvas) =>
    canvas.toDataURL("image/png").split(",")[1]);
  const output = path.join(os.tmpdir(), name);
  fs.writeFileSync(output, Buffer.from(data, "base64"));
  console.log(`[screenshot] ${output}`);
}

(async () => {
  const app = await electron.launch({
    executablePath,
    args: [root, "--no-sandbox", "--disable-gpu"],
    env: { ...process.env, SIERRASTUDIO_USER_DATA_DIR: userData }
  });
  try {
    const window = await app.firstWindow();
    window.setDefaultTimeout(30_000);
    window.on("console", (message) => {
      if (message.type() === "error") console.error("[renderer]", message.text());
    });
    window.on("pageerror", (error) => console.error("[pageerror]", error.message));
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(source));
    await window.getByRole("button", { name: "打开", exact: true })
      .evaluate((element) => element.click());
    await window.locator(".runtime-state.ready").waitFor();
    const compatibility = window.locator(".compatibility-dialog");
    if (await compatibility.count()) {
      await compatibility.getByRole("button", { name: "继续编辑" }).click();
    }

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const hourly = frame.locator("#hourly-chart");
    try {
      await hourly.waitFor();
    } catch (error) {
      console.error("[body]", (await window.locator("body").innerText()).slice(0, 2_000));
      console.error("[frames]", await window.locator("iframe").evaluateAll((frames) =>
        frames.map((item) => ({ src: item.src, title: item.title }))));
      throw error;
    }
    await hourly.locator("circle").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.locator(".svg-chart-status").waitFor();
    const hourlyPanel = await window.locator(".chart-editor").innerText();
    check(
      "clicking an SVG descendant selects the complete chart",
      hourlyPanel.includes("SVG 静态图表")
    );
    check(
      "hourly chart data is recovered with high confidence",
      hourlyPanel.includes("高可信")
        && hourlyPanel.includes("3 个系列")
        && hourlyPanel.includes("24 个分类"),
      hourlyPanel.replace(/\s+/g, " ")
    );
    check(
      "conversion is offered only for recoverable chart data",
      await window.getByRole("button", {
        name: "转换为可编辑图表"
      }).count() === 1
    );

    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    await frame.locator("#hourly-chart[_echarts_instance_]").waitFor();
    const converted = await hourly.evaluate((element) => {
      const config = JSON.parse(element.getAttribute("data-hs-chart-data"));
      return {
        type: config.type,
        labels: config.xAxis.length,
        series: config.series.length,
        engineReady: Boolean(window.echarts.getInstanceByDom(element))
      };
    });
    check(
      "conversion creates an editable ECharts chart",
      converted.type === "line"
        && converted.labels === 24
        && converted.series === 3
        && converted.engineReady,
      JSON.stringify(converted)
    );

    await window.keyboard.press("Control+z");
    await frame.locator("#hourly-chart svg").waitFor();
    const restored = await hourly.evaluate((element) => ({
      svg: Boolean(element.querySelector("svg")),
      chartAttr: element.hasAttribute("data-hs-chart")
    }));
    check(
      "undo restores the original custom SVG",
      restored.svg && !restored.chartAttr,
      JSON.stringify(restored)
    );

    const gender = frame.locator("#gender-chart");
    await gender.locator("rect").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.locator(".svg-chart-status").waitFor();
    const genderPanel = await window.locator(".chart-editor").innerText();
    check(
      "grouped vertical bars are recovered from geometry and visible labels",
      genderPanel.includes("SVG 静态图表")
        && genderPanel.includes("2 个系列")
        && genderPanel.includes("3 个分类")
    );
    check(
      "grouped bars can be converted",
      await window.getByRole("button", {
        name: "转换为可编辑图表"
      }).count() === 1
    );
    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    const genderConfig = await gender.evaluate((element) =>
      JSON.parse(element.getAttribute("data-hs-chart-data")));
    check(
      "grouped bar conversion preserves two colored series",
      genderConfig.type === "bar"
        && genderConfig.series.length === 2
        && genderConfig.series.every((series) => series.data.length === 3)
        && genderConfig.style.barOrientation === "vertical",
      JSON.stringify(genderConfig)
    );
    await saveRenderedChart(window, gender, "sierra-generic-grouped-bar.png");
    await window.keyboard.press("Control+z");
    await frame.locator("#gender-chart svg").waitFor();

    const industry = frame.locator("#industry-score-chart");
    await industry.locator("rect").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    const industryConfig = await industry.evaluate((element) =>
      JSON.parse(element.getAttribute("data-hs-chart-data")));
    check(
      "single-series vertical ranking uses the generic bar pipeline",
      industryConfig.type === "bar"
        && industryConfig.xAxis.length === 7
        && industryConfig.series[0].data.length === 7
        && industryConfig.style.categoryColors.length === 7,
      JSON.stringify(industryConfig)
    );
    await saveRenderedChart(window, industry, "sierra-generic-vertical-bar.png");
    await window.keyboard.press("Control+z");
    await frame.locator("#industry-score-chart svg").waitFor();

    const horizontal = frame.locator("#pet-love-chart");
    await horizontal.locator("rect").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    const horizontalConfig = await horizontal.evaluate((element) =>
      JSON.parse(element.getAttribute("data-hs-chart-data")));
    check(
      "horizontal rankings are inferred without chart-specific selectors",
      horizontalConfig.type === "bar"
        && horizontalConfig.xAxis.length === 7
        && horizontalConfig.style.barOrientation === "horizontal"
        && horizontalConfig.style.valueSuffix === "%",
      JSON.stringify(horizontalConfig)
    );
    await saveRenderedChart(window, horizontal, "sierra-generic-horizontal-bar.png");
    await window.keyboard.press("Control+z");
    await frame.locator("#pet-love-chart svg").waitFor();

    const platform = frame.locator("#platform-chart");
    await platform.locator("rect").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.locator(".svg-chart-status").waitFor();
    check(
      "overlapping grouped bars use DOM drawing order as a safe fallback",
      await window.getByRole("button", {
        name: "转换为可编辑图表"
      }).count() === 1
    );
    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    const platformConfig = await platform.evaluate((element) =>
      JSON.parse(element.getAttribute("data-hs-chart-data")));
    check(
      "drawing-order fallback restores the platform chart as three series",
      platformConfig.series.length === 3
        && platformConfig.xAxis.length === 3
        && platformConfig.series.every((series) => series.data.length === 3),
      JSON.stringify(platformConfig)
    );
    await window.keyboard.press("Control+z");
    await frame.locator("#platform-chart svg").waitFor();

    const pie = frame.locator("#overall-emotion-chart");
    await pie.locator("path").first().evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    await window.getByRole("button", {
      name: "转换为可编辑图表"
    }).click();
    await frame.locator("#overall-emotion-chart[_echarts_instance_]").waitFor();
    const pieStyle = await pie.evaluate((element) => {
      const config = JSON.parse(element.getAttribute("data-hs-chart-data"));
      const option = window.echarts.getInstanceByDom(element).getOption();
      const series = option.series?.[0] ?? {};
      return {
        palette: config.style?.palette,
        centerText: config.style?.pieCenterText,
        centerSubtext: config.style?.pieCenterSubtext,
        innerRatio: config.style?.pieInnerRatio,
        radius: series.radius,
        firstColor: series.data?.[0]?.itemStyle?.color,
        graphic: option.graphic,
        canvasCount: element.querySelectorAll("canvas").length,
        painted: [...element.querySelectorAll("canvas")].some((canvas) =>
          canvas.toDataURL().length > 1_000)
      };
    });
    check(
      "pie conversion preserves palette, donut geometry and center copy",
      pieStyle.palette?.length === 10
        && pieStyle.firstColor === pieStyle.palette[0]
        && Math.abs(pieStyle.innerRatio - 0.45) < 0.01
        && pieStyle.centerText === "100%"
        && pieStyle.centerSubtext === "全行业情绪"
        && pieStyle.canvasCount === 1
        && pieStyle.painted,
      JSON.stringify(pieStyle)
    );
    check(
      "the inspector reports the converted chart as a pie chart",
      await window.locator(".chart-editor select").inputValue() === "pie"
    );
    await window.waitForTimeout(1_200);
    const screenshotPath = path.join(os.tmpdir(), "sierra-svg-style-result.png");
    const canvasData = await pie.locator("canvas").evaluate((canvas) =>
      canvas.toDataURL("image/png").split(",")[1]);
    fs.writeFileSync(screenshotPath, Buffer.from(canvasData, "base64"));
    console.log(`[screenshot] ${screenshotPath}`);

    if (checks.some((item) => !item.pass)) process.exitCode = 1;
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
