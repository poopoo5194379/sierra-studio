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
  "style-library.html"
);
const USER_DATA = fs.mkdtempSync(
  path.join(os.tmpdir(), "sierra-style-library-")
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
    window.setDefaultTimeout(20_000);
    window.on("console", (message) => {
      if (message.type() === "error") {
        console.error("[renderer]", message.text());
      }
    });
    window.on("pageerror", (error) => {
      console.error("[pageerror]", error.message);
    });
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
    try {
      await window.locator(".runtime-state.ready").waitFor({
        timeout: 20_000
      });
    } catch (error) {
      console.error(
        "[runtime-state]",
        await window.locator(".runtime-state").allTextContents()
      );
      console.error(
        "[iframe]",
        await window.locator("iframe").evaluateAll((frames) =>
          frames.map((frame) => ({
            src: frame.getAttribute("src"),
            title: frame.getAttribute("title")
          }))
        )
      );
      console.error(
        "[body]",
        (await window.locator("body").innerText()).slice(0, 1_500)
      );
      throw error;
    }
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.count()) {
      await compatibilityDialog.getByRole("button", {
        name: "继续编辑"
      }).click();
    }
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const title = frame.locator(".custom-title");
    await title.waitFor();
    await title.evaluate((element) => element.click());
    await window.getByRole("tab", { name: "样式库" }).click();

    const builtinCard = window.locator(".style-preset-card", {
      hasText: "报告蓝主标题"
    });
    await builtinCard.waitFor();
    check(
      "shows compatible built-in presets for the selected element",
      await builtinCard.count() === 1
    );

    const originalColor = await title.evaluate(
      (element) => getComputedStyle(element).color
    );
    await builtinCard.hover();
    const previewColor = await title.evaluate(
      (element) => getComputedStyle(element).color
    );
    await window.locator(".style-library-heading").hover();
    const restoredColor = await title.evaluate(
      (element) => getComputedStyle(element).color
    );
    check(
      "hover preview is temporary and restores the original style",
      originalColor === "rgb(139, 38, 53)"
        && previewColor === "rgb(29, 78, 216)"
        && restoredColor === originalColor,
      JSON.stringify({ originalColor, previewColor, restoredColor })
    );

    await builtinCard.click();
    await window.waitForTimeout(150);
    const appliedColor = await title.evaluate(
      (element) => getComputedStyle(element).color
    );
    check(
      "applies a preset to the selected element",
      appliedColor === "rgb(29, 78, 216)",
      appliedColor
    );

    await window.getByRole("button", { name: "撤销" }).click();
    await window.waitForTimeout(200);
    const undoneColor = await title.evaluate(
      (element) => getComputedStyle(element).color
    );
    check(
      "preset application participates in undo",
      undoneColor === originalColor,
      undoneColor
    );

    await window.locator(".style-source-tabs button", {
      hasText: "当前文档"
    }).click();
    const documentPreset = window.locator(".style-preset-card", {
      hasText: "自定义报告标题"
    }).first();
    await documentPreset.waitFor();
    check(
      "extracts and deduplicates reusable styles from the document",
      await documentPreset.count() === 1
    );

    await window.locator("#style-preset-name").fill("我的报告标题");
    await window.locator(".style-save-current button").click();
    const savedPreset = window.locator(".style-preset-card", {
      hasText: "我的报告标题"
    });
    await savedPreset.waitFor();
    const storedPresets = await window.evaluate(() =>
      JSON.parse(
        localStorage.getItem("sierra-studio:user-style-presets:v1") || "[]"
      )
    );
    check(
      "saves the current element style to the personal library",
      await savedPreset.count() === 1
        && storedPresets.some((preset) => preset.name === "我的报告标题"),
      `stored=${storedPresets.length}`
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
