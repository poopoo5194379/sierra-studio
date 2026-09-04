const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const root = path.join(__dirname, "..");
  const packagedExecutable = process.env.SIERRA_EXECUTABLE;
  const executablePath = packagedExecutable
    ? path.resolve(packagedExecutable)
    : path.join(
      root,
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron"
    );
  const fixture = path.join(__dirname, "fixtures", "text-style-live.html");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-text-live-"));
  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: packagedExecutable ? [] : [root],
    env: { ...process.env, SIERRASTUDIO_USER_DATA_DIR: userData }
  });
  try {
    const window = await app.firstWindow();
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, fixture);
    const empty = window.locator(".empty-state");
    if (await empty.count()) await empty.evaluate((element) => element.click());
    else {
      await window.getByRole("button", { name: "打开", exact: true }).evaluate(
        (element) => element.click()
      );
    }

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const paragraph = frame.locator("[data-hs-id='text-live']");
    await paragraph.waitFor({ timeout: 30_000 });
    await paragraph.evaluate((element) => {
      element.click();
      const text = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      ).nextNode();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    const controls = window.locator(".text-style-controls");
    await controls.waitFor();
    const color = controls.locator("input[type='color']").first();
    await color.evaluate((input) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, "#ff3344");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await window.waitForTimeout(120);
    const colorHtml = await paragraph.innerHTML();

    const fontSize = controls.locator(".text-font-size-input");
    await fontSize.fill("52");
    await window.waitForTimeout(120);
    const sizeHtml = await paragraph.innerHTML();
    const sizeControl = await fontSize.inputValue();
    await window.getByTitle("缩小字号").evaluate((element) => element.click());
    await window.waitForTimeout(250);
    const smallerHtml = await paragraph.innerHTML();

    await paragraph.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !text.textContent?.includes("普通文字")) {
        text = walker.nextNode();
      }
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await window.waitForTimeout(200);
    const plainCaretSize = await fontSize.inputValue();

    await paragraph.evaluate((element) => {
      const sized = element.querySelector("[style*='font-size']");
      const walker = document.createTreeWalker(
        sized,
        NodeFilter.SHOW_TEXT
      );
      let text = walker.nextNode();
      while (text && !text.textContent?.length) text = walker.nextNode();
      const range = document.createRange();
      range.setStart(text, Math.min(1, text.textContent?.length ?? 0));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await window.waitForTimeout(200);
    const styledCaretSize = await fontSize.inputValue();

    const result = {
      colorLive: /#ff3344|rgb\(255,\s*51,\s*68\)/i.test(colorHtml),
      sizeAbove48Live: /font-size:\s*52px/i.test(sizeHtml)
        && sizeControl === "52",
      minusWorks: /font-size:\s*50px/i.test(smallerHtml),
      plainCaretSize,
      styledCaretSize,
      errors
    };
    console.log(JSON.stringify(result, null, 2));
    if (
      !result.colorLive
      || !result.sizeAbove48Live
      || !result.minusWorks
      || plainCaretSize !== "16"
      || styledCaretSize !== "50"
      || errors.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
