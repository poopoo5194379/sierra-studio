const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { _electron: electron } = require("playwright");

const ROOT = path.join(__dirname, "..");
const EXECUTABLE = path.join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const TEST_HTML = path.join(
  ROOT,
  "scripts",
  "fixtures",
  "batch-image-slots.html"
);
const SVG_IMAGE = path.join(ROOT, "scripts", "fixtures", "test-image.svg");
const PNG_IMAGE = path.join(ROOT, "build", "icon.png");
const USER_DATA = fs.mkdtempSync(
  path.join(os.tmpdir(), "sierra-batch-images-")
);

const checks = [];
function check(name, pass, info = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${info ? ` — ${info}` : ""}`);
}

(async () => {
  const app = await electron.launch({
    executablePath: EXECUTABLE,
    args: [ROOT, "--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"],
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: USER_DATA
    }
  });
  try {
    const window = await app.firstWindow();
    window.setDefaultTimeout(15_000);
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, TEST_HTML);
    const emptyState = window.locator(".empty-state");
    if (await emptyState.count()) {
      await emptyState.evaluate((element) => element.click());
    } else {
      await window.getByRole("button", { name: "打开", exact: true })
        .evaluate((element) => element.click());
    }
    await window.locator(".runtime-state.ready").waitFor({
      timeout: 120_000
    });
    await window.waitForTimeout(2500);

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator(".brand-media-card").waitFor({ timeout: 120_000 });
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.count()) {
      await compatibilityDialog.getByRole("button", {
        name: "继续编辑"
      }).click();
    }
    await window.getByRole("button", { name: "资源" }).click();
    await window.getByRole("button", { name: /选择图片槽/ }).click();
    await window.waitForTimeout(250);
    const pickerText = await window.locator(".asset-import", {
      hasText: /完成点选/
    }).textContent();
    check(
      "detects common semantic, standalone, background, and dynamic slots",
      /识别到 7 个候选槽位/.test(pickerText ?? ""),
      pickerText ?? ""
    );

    await window.locator(".asset-import").nth(1).click();
    const altClick = async (selector) => {
      await frame.locator(selector).evaluate((element) => {
        for (const type of ["mousedown", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            altKey: true,
            button: 0
          }));
        }
      });
    };
    await altClick(".brand-media-card");
    await altClick(".image-placeholder");
    await altClick(".cover-visual");
    await window.waitForTimeout(150);
    const selectedText = await window.locator(".asset-import").nth(2)
      .textContent();
    check(
      "Alt + single-click directly multi-selects image slots",
      /3/.test(selectedText ?? ""),
      selectedText ?? ""
    );

    await app.evaluate(({ dialog }, selectedPaths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: selectedPaths
      });
    }, [SVG_IMAGE, PNG_IMAGE, SVG_IMAGE]);
    await window.locator(".asset-import").nth(2).click();
    const orderDialog = window.locator(".image-order-dialog");
    await orderDialog.waitFor();
    const orderCards = orderDialog.locator(".image-order-card");
    check(
      "shows a thumbnail order confirmation before embedding",
      await orderCards.count() === 3
        && /图片 1 → 槽位 1/.test(await orderCards.first().textContent()),
      `cards=${await orderCards.count()}`
    );
    await orderCards.first().getByTitle("下移").click();
    const reorderedNames = await orderCards.locator(
      ".image-order-card-meta strong"
    ).allTextContents();
    check(
      "supports changing the image-to-slot order before confirmation",
      reorderedNames[0] === "icon.png"
        && reorderedNames[1] === "test-image.svg",
      JSON.stringify(reorderedNames)
    );
    await orderDialog.getByRole("button", {
      name: /按当前顺序嵌入/
    }).click();
    await window.waitForTimeout(900);
    const result = await frame.locator("body").evaluate(() => ({
      brand: document.querySelector(".brand-media-card img")
        ?.getAttribute("src"),
      empty: document.querySelector(".image-placeholder img")
        ?.getAttribute("src"),
      background: document.querySelector(".cover-visual")
        ? getComputedStyle(document.querySelector(".cover-visual"))
          .backgroundImage
        : "",
      watermark: document.querySelector(".report-logo-watermark")
        ?.getAttribute("src")
    }));
    check(
      "maps files to selected slots in order",
      result.brand?.startsWith("data:image/png;base64,")
        && result.empty?.startsWith("data:image/svg+xml;base64,")
        && result.background?.includes("data:image/svg+xml;base64,"),
      JSON.stringify({
        brand: result.brand?.slice(0, 28),
        empty: result.empty?.slice(0, 28),
        background: result.background?.slice(0, 36)
      })
    );
    check(
      "leaves decorative watermarks untouched",
      !result.watermark,
      `watermark=${result.watermark ?? "(empty)"}`
    );

    await window.locator(".activity-rail button").first().click();
    await window.locator(".document-search input").fill("Navigation target");
    const navigationResult = window.locator(
      ".document-search-results button",
      { hasText: "Navigation target" }
    ).first();
    await navigationResult.waitFor();
    await navigationResult.click();
    await window.waitForTimeout(250);
    const located = await frame.locator("body").evaluate(() => {
      const target = document.querySelector(".navigation-target");
      if (!(target instanceof HTMLElement)) return null;
      const rect = target.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        highlighted: target.classList.contains("hs-locate-flash")
      };
    });
    check(
      "document navigation scrolls the target into view and highlights it",
      Boolean(
        located
        && located.scrollY > 500
        && located.top >= 0
        && located.bottom <= located.viewportHeight
        && located.highlighted
      ),
      JSON.stringify(located)
    );
  } finally {
    await app.close();
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  }
  if (checks.some((item) => !item.pass)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
