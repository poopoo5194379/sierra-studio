const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error("Usage: node scripts/verify-watermarks.cjs <html-path>");
}

const executablePath = process.env.SIERRA_EXECUTABLE
  ? path.resolve(process.env.SIERRA_EXECUTABLE)
  : path.join(
    root,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-watermarks-"));
const sourceProjectDir = path.dirname(path.dirname(path.resolve(sourcePath)));
const sourceProjectJson = path.join(sourceProjectDir, "project.json");
const copiedProject = fs.existsSync(sourceProjectJson)
  ? JSON.parse(fs.readFileSync(sourceProjectJson, "utf8"))
  : null;
if (copiedProject) {
  fs.mkdirSync(path.join(userDataDir, "projects"), { recursive: true });
  fs.cpSync(
    sourceProjectDir,
    path.join(userDataDir, "projects", copiedProject.projectId),
    { recursive: true }
  );
}
const checks = [];

function check(name, pass, details = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${details ? `: ${details}` : ""}`);
}

(async () => {
  console.log("STEP launch");
  const app = await electron.launch({
    executablePath,
    args: [
      ...(process.env.SIERRA_EXECUTABLE ? [] : [root]),
      "--no-sandbox",
      "--disable-gpu"
    ],
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: userDataDir
    }
  });
  try {
    const window = await app.firstWindow();
    console.log("STEP window");
    window.on("pageerror", (error) => console.log("PAGEERROR", error.stack));
    window.on("console", (message) => {
      if (message.type() === "error") {
        console.log("CONSOLE", message.text(), message.location());
      }
    });
    await window.locator(".activity-rail").waitFor({ timeout: 30_000 });
    console.log("RUNTIME_FETCH", await app.evaluate(async ({ net }) => {
      const response = await net.fetch(
        "htmlstudio-runtime://bundle/editor-runtime.js"
      );
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        length: (await response.arrayBuffer()).byteLength
      };
    }));
    window.setDefaultTimeout(30_000);
    if (copiedProject) {
      console.log("STEP restore-project");
      await window.evaluate((projectId) => {
        localStorage.setItem("sierra-studio:last-project", projectId);
      }, copiedProject.projectId);
      await window.reload();
      await window.locator(".activity-rail").waitFor({ timeout: 30_000 });
    } else {
      await app.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath]
        });
      }, path.resolve(sourcePath));
      const emptyState = window.locator(".empty-state");
      if (await emptyState.count()) {
        console.log("STEP import-empty");
        await emptyState.click();
      } else {
        console.log("STEP import-toolbar");
        await window.locator(".toolbar .toolbar-button").first().click();
      }
      await window.locator(".compatibility-dialog").waitFor({
        timeout: 30_000
      }).catch(() => {});
      const compatibilityDialog = window.locator(".compatibility-dialog");
      if (await compatibilityDialog.count()) {
        console.log("STEP compatibility");
        await compatibilityDialog.locator("button.primary").click();
      }
    }
    console.log("STEP wait-ready");
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 })
      .catch(async (error) => {
        const iframe = window.locator('iframe[title="HTML editing canvas"]');
        console.log("DEBUG HOST", await window.locator("body").evaluate(() => ({
          runtime: document.querySelector(".runtime-state")?.className || "",
          runtimeText: document.querySelector(".runtime-state")?.textContent || "",
          notice: document.querySelector(".notice")?.textContent || "",
          iframeSrc: document.querySelector(
            'iframe[title="HTML editing canvas"]'
          )?.getAttribute("src") || ""
        })));
        if (await iframe.count()) {
          console.log("DEBUG FRAME", await iframe.contentFrame().locator("html")
            .evaluate(() => ({
              readyState: document.readyState,
              text: document.body?.innerText.slice(0, 200) || "",
              scriptCount: document.scripts.length,
              scriptSources: [...document.scripts].map((script) => script.src),
              runtimeLoaded: Boolean(globalThis.__htmlStudioRuntimeLoaded),
              runtimeKeys: Object.keys(globalThis)
                .filter((key) => /runtime|htmlStudio/i.test(key))
                .slice(0, 20)
            })).catch((frameError) => ({
              error: String(frameError)
            })));
        }
        throw error;
      });
    console.log("STEP ready");

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator(".company-watermark").first().waitFor({
      timeout: 120_000
    });
    const legacyDisplaysBefore = await frame.locator(".company-watermark")
      .evaluateAll((images) => images.map(
        (image) => getComputedStyle(image).display
      ));
    console.log("STEP source-visible");
    await window.getByRole("button", { name: "全局水印" }).click();
    await window.getByTitle("重新检测现有水印").click();

    const detection = window.locator(".watermark-detection").first();
    await detection.waitFor({ timeout: 30_000 });
    const detectionText = await detection.textContent();
    check(
      "recognizes all repeated legacy logos",
      /38/.test(detectionText || "") && /\.company-watermark/.test(detectionText || ""),
      detectionText || ""
    );

    await detection.getByRole("button", { name: "转换" }).click();
    const preview = await frame.locator("body").evaluate(() => ({
      originalCount: document.querySelectorAll(".company-watermark").length,
      originalHidden: [...document.querySelectorAll(".company-watermark")]
        .every((node) => getComputedStyle(node).display === "none"),
      layerCount: document.querySelectorAll("[data-hs-watermark-layer]").length,
      itemCount: document.querySelectorAll("[data-hs-watermark-id]").length,
      manifestCount: document.querySelectorAll(
        "script[data-hs-watermark-manifest]"
      ).length
    }));
    check(
      "conversion preview suppresses originals and creates one item per page",
      preview.originalCount === 38
        && preview.originalHidden
        && preview.layerCount === 38
        && preview.itemCount === 38
        && preview.manifestCount === 1,
      JSON.stringify(preview)
    );

    const values = await window.locator(".watermark-editor input[type=number]")
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    const activeAnchor = await window.locator(
      ".watermark-anchor-grid button.active"
    ).textContent();
    check(
      "preserves inferred top-right geometry and opacity",
      activeAnchor === "右上"
        && Number(values[0]) >= 24
        && Number(values[0]) <= 26
        && Number(values[1]) >= 70
        && Number(values[1]) <= 75,
      `anchor=${activeAnchor}, values=${values.join(",")}`
    );

    await window.getByRole("button", { name: "应用并保存" }).click();
    await window.getByText("已保存 1 个全局水印").waitFor();
    await window.waitForTimeout(500);
    await window.getByRole("button", { name: "插入" }).click();
    await frame.locator("[data-hs-watermark-id]").first().dispatchEvent(
      "click"
    );
    await window.locator(
      '.activity-rail button[aria-label="全局水印"].active'
    ).waitFor({ timeout: 1_000 }).catch(() => {});
    const directSelection = await frame.locator("body").evaluate(() => {
      const layer = document.querySelector("[data-hs-watermark-layer]");
      const item = document.querySelector("[data-hs-watermark-id]");
      const rect = item?.getBoundingClientRect();
      const hit = rect
        ? document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        )
        : null;
      return {
        layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : "",
        itemPointerEvents: item ? getComputedStyle(item).pointerEvents : "",
        hitTag: hit?.tagName || "",
        hitWatermark: hit?.getAttribute("data-hs-watermark-id") || ""
      };
    });
    directSelection.activePanel = await window.locator(
      ".activity-rail button.active"
    ).textContent();
    directSelection.activeWatermarks = await window.locator(
      ".watermark-list button.active"
    ).count();
    check(
      "canvas watermark click opens its global settings without blocking page",
      await window.getByRole("button", { name: "全局水印" })
        .evaluate((button) => button.classList.contains("active"))
        && directSelection.activeWatermarks === 1
        && directSelection.layerPointerEvents === "none"
        && directSelection.itemPointerEvents === "auto",
      JSON.stringify(directSelection)
    );
    await window.getByRole("button", { name: "撤销" }).click();
    await frame.locator("[data-hs-watermark-layer]").first().waitFor({
      state: "detached"
    });
    const undone = await frame.locator("body").evaluate(() => ({
      originalDisplays: [...document.querySelectorAll(".company-watermark")]
        .map((node) => getComputedStyle(node).display),
      layerCount: document.querySelectorAll("[data-hs-watermark-layer]").length,
      styleCount: document.querySelectorAll(
        "style[data-hs-watermark-style]"
      ).length,
      firstDisplay: getComputedStyle(
        document.querySelector(".company-watermark")
      ).display,
      matchingRules: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .map((rule) => rule.cssText)
            .filter((text) => text.includes(".company-watermark"));
        } catch {
          return [];
        }
      }).slice(-5)
    }));
    check(
      "undo restores legacy watermarks",
      JSON.stringify(undone.originalDisplays)
        === JSON.stringify(legacyDisplaysBefore)
        && undone.layerCount === 0
        && undone.styleCount === 0,
      JSON.stringify(undone)
    );

    await window.getByRole("button", { name: "重做" }).click();
    await frame.locator("[data-hs-watermark-layer]").first().waitFor();
    const redone = await frame.locator("body").evaluate(() => ({
      originalHidden: [...document.querySelectorAll(".company-watermark")]
        .every((node) => getComputedStyle(node).display === "none"),
      layerCount: document.querySelectorAll("[data-hs-watermark-layer]").length,
      manifest: document.querySelector(
        "script[data-hs-watermark-manifest]"
      )?.textContent || ""
    }));
    check(
      "redo restores editable global watermark settings",
      redone.originalHidden
        && redone.layerCount === 38
        && redone.manifest.includes('"anchor":"top-right"'),
      `layers=${redone.layerCount}, manifest=${redone.manifest.length}`
    );
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  if (checks.some((entry) => !entry.pass)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
