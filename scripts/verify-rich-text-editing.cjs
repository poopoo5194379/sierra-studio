const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Pass an HTML report path");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-rich-text-"));
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

(async () => {
  const app = await electron.launch({
    executablePath,
    args: [root, "--no-sandbox", "--disable-gpu"],
    env: { ...process.env, SIERRASTUDIO_USER_DATA_DIR: userData }
  });
  try {
    const window = await app.firstWindow();
    window.setDefaultTimeout(30_000);
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(source));
    await window.getByRole("button", { name: "打开", exact: true })
      .evaluate((element) => element.click());
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const richParagraph = frame.locator("p:has(strong):has(sup)").first();
    await richParagraph.waitFor();
    const compatibility = window.locator(".compatibility-dialog");
    if (await compatibility.count()) {
      await compatibility.getByRole("button", { name: "继续编辑" }).click();
    }
    await richParagraph.evaluate((element) => element.click());
    await window.locator(".rich-text-edit-card").waitFor();
    check(
      "rich paragraphs expose a non-destructive canvas edit action",
      await window.getByRole("button", {
        name: "在画布中编辑文字"
      }).count() === 1
    );
    await window.getByRole("button", {
      name: "在画布中编辑文字"
    }).click();
    check(
      "the complete paragraph enters contentEditable",
      await richParagraph.getAttribute("contenteditable") === "true"
    );
    const before = await richParagraph.innerHTML();
    await richParagraph.evaluate((element) => {
      element.appendChild(document.createTextNode(" 可编辑验证"));
    });
    await window.locator(".rich-text-edit-card").click();
    const after = await richParagraph.innerHTML();
    check(
      "editing preserves strong and footnote markup",
      after.includes("可编辑验证")
        && after.includes("<strong")
        && after.includes("<sup"),
      after
    );

    await window.keyboard.press("Control+z");
    await frame.locator("p:has(strong):has(sup)").first().waitFor();
    const restored = await frame.locator("p:has(strong):has(sup)").first()
      .innerHTML();
    check("rich text edit is undoable", restored === before, restored);

    const inlineStrong = frame.locator("p:has(strong):has(sup) strong").first();
    await inlineStrong.evaluate((element) =>
      element.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    check(
      "double-clicking inline markup promotes editing to the paragraph",
      await frame.locator("p:has(strong):has(sup)").first()
        .getAttribute("contenteditable") === "true"
    );
    await window.locator(".inspector-tabs").click();

    const mixedRun = frame.locator("[data-hs-text-run]").first();
    await mixedRun.waitFor();
    const mixedMarkup = await mixedRun.innerHTML();
    check(
      "bare text inside structural cards is wrapped as a selectable text run",
      mixedMarkup.length > 0
    );
    await mixedRun.evaluate((element) =>
      element.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        view: window
      })));
    check(
      "mixed structural-card text enters contentEditable",
      await mixedRun.getAttribute("contenteditable") === "true"
    );

    if (checks.some((item) => !item.pass)) process.exitCode = 1;
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
