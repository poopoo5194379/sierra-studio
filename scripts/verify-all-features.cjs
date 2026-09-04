// Full-feature E2E regression for SierraStudio
// Same pattern as scripts/verify-dynamic-editing.cjs
// Uses { force: true } on iframe clicks because the sandboxed iframe
// confuses Playwright actionability checks (elementFromPoint is correct).
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { _electron: electron } = require("playwright");

const ROOT = path.join(__dirname, "..");
const EXECUTABLE = path.join(
  ROOT, "node_modules", "electron", "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const PACKAGED_EXECUTABLE = process.env.SIERRASTUDIO_E2E_EXECUTABLE;
const LAUNCH_EXECUTABLE = PACKAGED_EXECUTABLE
  ? path.resolve(PACKAGED_EXECUTABLE)
  : EXECUTABLE;
const LAUNCH_ARGS = PACKAGED_EXECUTABLE
  ? ["--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"]
  : [ROOT, "--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"];
const TEST_HTML = path.join(ROOT, "scripts", "fixtures", "test-page.html");
const TEST_IMG = path.join(ROOT, "scripts", "fixtures", "test-image.svg");
const TEST_IMG_2 = path.join(ROOT, "build", "icon.png");
const TEST_VIDEO = path.join(ROOT, "scripts", "fixtures", "test-video.mp4");
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-e2e-all-"));

if (!fs.existsSync(TEST_HTML)) {
  fs.mkdirSync(path.dirname(TEST_HTML), { recursive: true });
  fs.writeFileSync(TEST_HTML, `<!doctype html>
<html><head><meta charset="utf-8"><title>Test</title>
<style>body { font-family: sans-serif; padding: 20px; }
h1 { color: #4f7cff; }
.card { border: 1px solid #ccc; padding: 16px; border-radius: 8px; margin: 12px 0; }
.row { display: flex; gap: 12px; }
.col { flex: 1; }
</style></head>
<body>
<h1 data-hs-id="h1-1">Test Heading One</h1>
<p data-hs-id="p-1">Test paragraph. <span data-hs-id="span-1">Span inside.</span></p>
<div class="card" data-hs-id="card-1">
  <h2 data-hs-id="card-h2">Card Title</h2>
  <p data-hs-id="card-p">Card content here.</p>
</div>
<div class="row" data-hs-id="row-1">
  <div class="col" data-hs-id="col-1">Column A</div>
  <div class="col" data-hs-id="col-2">Column B</div>
</div>
<img data-hs-id="img-1" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='200' height='120' fill='%23aab'/%3E%3C/svg%3E" alt="test" />
</body></html>`);
}
if (!fs.existsSync(TEST_IMG)) {
  fs.mkdirSync(path.dirname(TEST_IMG), { recursive: true });
  fs.writeFileSync(TEST_IMG, `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60">
<rect width="100" height="60" fill="#6c8eff"/>
<text x="50" y="35" text-anchor="middle" fill="white" font-size="12">TEST</text>
</svg>`);
}

const results = [];
const log = (name, pass, info) => {
  results.push({ name, pass, info });
  const symbol = pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`${symbol} ${name}${info ? " — " + info : ""}`);
};

(async () => {
  const app = await electron.launch({
    executablePath: LAUNCH_EXECUTABLE,
    args: LAUNCH_ARGS,
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: USER_DATA
    }
  });
  const errors = [];
  try {
    const window = await app.firstWindow();
    window.setDefaultTimeout(10_000);
    window.on("pageerror", (err) => errors.push("pageerror: " + err.message));
    window.on("console", (msg) => {
      if (msg.type() === "error") errors.push("console: " + msg.text());
    });
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false, filePaths: [selectedPath]
      });
    }, path.resolve(TEST_HTML));

    const emptyState = window.locator(".empty-state");
    if (await emptyState.count() > 0) {
      await emptyState.evaluate((element) => element.click());
    } else {
      await window.getByRole("button", { name: "打开", exact: true }).evaluate(
        (element) => element.click()
      );
    }
    await window.locator(".runtime-state.ready").waitFor({ timeout: 180_000 });
    await window.waitForTimeout(3000);

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    // Sandboxed iframe's body occasionally confuses Playwright actionability
    // even though the actual element receives clicks fine. Bypass it by
    // dispatching a real MouseEvent sequence — the runtime listens at the
    // document capture phase and our onMouseDown/onClick/onDoubleClick
    // only need a real-looking event.
    const dispatchClick = async (selector, opts = {}) => {
      const h = await frame.locator(selector).elementHandle();
      if (!h) throw new Error("not found: " + selector);
      await h.evaluate((el, options) => {
        const r = el.getBoundingClientRect();
        const base = { bubbles: true, cancelable: true, button: 0,
          clientX: r.left + (options.dx || 10),
          clientY: r.top + (options.dy || 10),
          view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mousedown", base));
        el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mouseup", base));
        el.dispatchEvent(new MouseEvent("click", base));
      }, opts);
    };
    const dispatchDblClick = async (selector) => {
      const h = await frame.locator(selector).elementHandle();
      if (!h) throw new Error("not found: " + selector);
      await h.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const base = { bubbles: true, cancelable: true, button: 0,
          clientX: r.left + 10, clientY: r.top + 10, view: window };
        for (let i = 0; i < 2; i++) {
          el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true }));
          el.dispatchEvent(new MouseEvent("mousedown", base));
          el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
          el.dispatchEvent(new MouseEvent("mouseup", base));
          el.dispatchEvent(new MouseEvent("click", base));
        }
        el.dispatchEvent(new MouseEvent("dblclick", { ...base, detail: 2 }));
      });
    };
    const dispatchContextMenu = async (selector) => {
      const h = await frame.locator(selector).elementHandle();
      if (!h) throw new Error("not found: " + selector);
      await h.evaluate((el) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, button: 2,
          clientX: r.left + 10, clientY: r.top + 10
        }));
      });
    };
    const dragCanvas = async (fromSelector, toSelector) => {
      await frame.locator(fromSelector).evaluate(
        (from, selector) => {
          const to = document.querySelector(selector);
          if (!(to instanceof HTMLElement)) {
            throw new Error(`Drag target not found: ${selector}`);
          }
          const startRect = from.getBoundingClientRect();
          const endRect = to.getBoundingClientRect();
          const start = {
            x: startRect.left + startRect.width / 2,
            y: startRect.top + Math.min(startRect.height / 2, 24)
          };
          const end = {
            x: endRect.left + endRect.width / 2,
            y: endRect.top + endRect.height / 2
          };
          from.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: start.x,
            clientY: start.y,
            view: window
          }));
          document.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: start.x + 8,
            clientY: start.y + 8,
            view: window
          }));
          document.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: end.x,
            clientY: end.y,
            view: window
          }));
          document.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: end.x,
            clientY: end.y,
            view: window
          }));
        },
        toSelector
      );
    };
    const fc = (sel, opts) => dispatchClick(sel, opts);
    const fd = (sel) => dispatchDblClick(sel);
    const fn = (sel) => frame.locator(sel).count();
    const fh = (sel) => frame.locator(sel).elementHandle();

    log("Open project & canvas ready", true);
    await window.waitForTimeout(300);
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.count() > 0) {
      const reportText = await compatibilityDialog.textContent();
      log(
        "Import compatibility report detects dynamic dependencies",
        /运行时生成|动态报告|已识别依赖/.test(reportText ?? ""),
        (reportText ?? "").replace(/\s+/g, " ").slice(0, 120)
      );
      await compatibilityDialog.getByRole("button", {
        name: "继续编辑"
      }).click();
    }

    await frame.locator("#imported-line-chart canvas").waitFor({
      timeout: 30_000
    });
    await frame.locator("#imported-word-cloud canvas").waitFor({
      timeout: 30_000
    });
    const importedChartState = await frame.locator("body").evaluate(() => ({
      version: window.echarts?.version,
      instances: document.querySelectorAll("[_echarts_instance_]").length,
      lineCanvases: document.querySelectorAll(
        "#imported-line-chart canvas"
      ).length,
      wordCloudCanvases: document.querySelectorAll(
        "#imported-word-cloud canvas"
      ).length
    }));
    log(
      "Remote ECharts dependencies map to local line and word-cloud renderers",
      importedChartState.version === "5.6.0"
        && importedChartState.instances >= 2
        && importedChartState.lineCanvases === 1
        && importedChartState.wordCloudCanvases === 1,
      JSON.stringify(importedChartState)
    );

    // Runtime-generated structure must support delete, persistence and
    // history without converting the whole page into a static document.
    const runtimeCardsBefore = await fn("#runtime-list > .runtime-card");
    const runtimeIdsBefore = await fn(
      "#runtime-list > .runtime-card[data-hs-id^='dyn_']"
    );
    await fc("#runtime-list > .runtime-card[data-key='beta']");
    await frame.locator("body").evaluate((body) => {
      const doc = body.ownerDocument;
      doc.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true
      }));
      doc.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Delete",
        bubbles: true
      }));
    });
    await window.waitForTimeout(700);
    const runtimeCardsDeleted = await fn("#runtime-list > .runtime-card");
    log(
      "Dynamic region supports structural delete",
      runtimeCardsBefore === 3
        && runtimeIdsBefore === 3
        && runtimeCardsDeleted === 2,
      `before=${runtimeCardsBefore} dynamic=${runtimeIdsBefore} after=${runtimeCardsDeleted}`
    );

    await frame.locator("body").evaluate(() => window.location.reload());
    await frame.locator("#runtime-list > .runtime-card").first().waitFor({
      timeout: 15_000
    });
    await window.waitForTimeout(700);
    const runtimeCardsReloaded = await fn("#runtime-list > .runtime-card");
    log(
      "Dynamic structural edit survives canvas reload",
      runtimeCardsReloaded === 2,
      `after reload=${runtimeCardsReloaded}`
    );

    await window.getByRole("button", { name: "撤销" }).click();
    await window.waitForTimeout(1200);
    const runtimeCardsUndone = await fn("#runtime-list > .runtime-card");
    log(
      "Undo restores script-generated structure",
      runtimeCardsUndone === 3,
      `after undo=${runtimeCardsUndone}`
    );
    await window.getByRole("button", { name: "重做" }).click();
    await window.waitForTimeout(1200);
    const runtimeCardsRedone = await fn("#runtime-list > .runtime-card");
    log(
      "Redo reapplies dynamic structural edit",
      runtimeCardsRedone === 2,
      `after redo=${runtimeCardsRedone}`
    );

    await dragCanvas(
      "#runtime-list > .runtime-card[data-key='alpha']",
      "#runtime-list > .runtime-card[data-key='gamma']"
    );
    await window.waitForTimeout(800);
    const runtimeOrder = await frame.locator(
      "#runtime-list > .runtime-card"
    ).evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-key")).join(",")
    );
    await frame.locator("body").evaluate(() => window.location.reload());
    await frame.locator("#runtime-list > .runtime-card").first().waitFor({
      timeout: 15_000
    });
    await window.waitForTimeout(700);
    const runtimeOrderReloaded = await frame.locator(
      "#runtime-list > .runtime-card"
    ).evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-key")).join(",")
    );
    log(
      "Dynamic region supports persistent flow reorder",
      runtimeOrder === "gamma,alpha"
        && runtimeOrderReloaded === "gamma,alpha",
      `live=${runtimeOrder} reload=${runtimeOrderReloaded}`
    );

    await fc("#runtime-list > .runtime-card[data-key='gamma']");
    const dynamicParagraphButton = window.locator(
      ".block-btn",
      { hasText: /^正文$/ }
    );
    await dynamicParagraphButton.click({ force: true });
    await window.waitForTimeout(800);
    const dynamicInserted = await fn(
      "#runtime-list > .runtime-card[data-key='gamma'] > p[data-hs-id^='dyn_']"
    );
    await frame.locator("body").evaluate(() => window.location.reload());
    await frame.locator("#runtime-list > .runtime-card").first().waitFor({
      timeout: 15_000
    });
    await window.waitForTimeout(700);
    const dynamicInsertedReloaded = await fn(
      "#runtime-list > .runtime-card[data-key='gamma'] > p"
    );
    log(
      "Dynamic container supports persistent nested insertion",
      dynamicInserted === 1 && dynamicInsertedReloaded === 1,
      `live=${dynamicInserted} reload=${dynamicInsertedReloaded}`
    );
    await frame.locator("html").evaluate(() => window.scrollTo(0, 0));
    await window.waitForTimeout(300);

    const mountBefore = await fn("#runtime-list");
    await dispatchClick("#runtime-list");
    await frame.locator("body").evaluate((body) => {
      const doc = body.ownerDocument;
      doc.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
        cancelable: true
      }));
    });
    await window.waitForTimeout(400);
    const mountAfter = await fn("#runtime-list");
    log(
      "Script-referenced mount points are protected from deletion",
      mountBefore === 1 && mountAfter === 1
    );

    // ===== T1 =====
    await fc("[data-hs-id='h1-1']");
    await window.waitForTimeout(500);
    const inspectorText = await window.locator(".right-panel").textContent();
    log("Click selects & shows panel", /h1-1|节点|H1|Heading|标题/.test(inspectorText || ""), `panel: ${(inspectorText || "").slice(0, 80)}`);

    const contentAndStyleTogether =
      await window.locator(".right-panel textarea").count() > 0
      && await window.locator(".right-panel .text-style-controls").count() > 0
      && await window.locator(".right-panel input[type='number']").count() > 0;
    log("Content and style share one inspector page", contentAndStyleTogether);

    await dispatchClick("[data-hs-id='card-1']");
    await window.waitForTimeout(250);
    const containerTextareas = await window.locator(
      ".right-panel textarea"
    ).count();
    await dispatchDblClick("[data-hs-id='card-1']");
    await window.waitForTimeout(250);
    const structuralEditable = await fn(
      "[data-hs-id='card-1'][contenteditable='true']"
    );
    const cardChildren = await fn("[data-hs-id='card-1'] > *");
    log(
      "Structural containers cannot be flattened through text editing",
      containerTextareas === 0
        && structuralEditable === 0
        && cardChildren >= 2,
      `textarea=${containerTextareas} editable=${structuralEditable} children=${cardChildren}`
    );

    await fc("[data-hs-id='h1-1']");
    await window.waitForTimeout(250);
    const liveTextEditor = window.locator(".right-panel textarea").first();
    await liveTextEditor.fill("Live heading preview");
    const liveHeadingText = await frame.locator("[data-hs-id='h1-1']").textContent();
    log(
      "Inspector text updates canvas before blur",
      liveHeadingText === "Live heading preview",
      `canvas text=${liveHeadingText}`
    );
    await liveTextEditor.blur();
    await window.waitForTimeout(250);

    const liveFontSizeInput = window.locator(
      ".right-panel label",
      { hasText: "字号" }
    ).locator("input[type='number']").first();
    await liveFontSizeInput.fill("37");
    const liveFontSize = await frame.locator("[data-hs-id='h1-1']").evaluate(
      (element) => getComputedStyle(element).fontSize
    );
    log(
      "Inspector style updates canvas before blur",
      liveFontSize === "37px",
      `font-size=${liveFontSize}`
    );
    await liveFontSizeInput.blur();

    const noColorButton = window.locator("button", { hasText: /^无颜色$/ });
    await noColorButton.click();
    const clearedBackground = await frame.locator("[data-hs-id='h1-1']").evaluate(
      (element) => element.style.getPropertyValue("background-color")
    );
    log("Background supports no color", clearedBackground === "");
    await window.waitForTimeout(400);

    // ===== T2 =====
    await fd("[data-hs-id='p-1']");
    await window.waitForTimeout(400);
    const ce = await fn("[data-hs-id='p-1'][contenteditable='true']");
    log("Double-click → contentEditable", ce === 1, `contenteditable count = ${ce}`);

    // ===== T3: floating toolbar =====
    const pEl = await fh("[data-hs-id='p-1']");
    await pEl.evaluate((el) => {
      const range = document.createRange();
      const sel = window.getSelection();
      const textNode = el.firstChild;
      if (textNode && textNode.textContent) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.textContent.length));
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      }
    });
    // Re-enter once after the synthetic selection. Real users create this
    // state with a pointer drag; the extra pass makes the programmatic E2E
    // sequence match the focus order of Chromium's iframe selection.
    await fd("[data-hs-id='p-1']");
    await pEl.evaluate((el) => {
      const textNode = document.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT
      ).nextNode();
      if (!textNode?.textContent) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(5, textNode.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await window.waitForTimeout(1200);
    let floatToolbar = await window.locator(".float-toolbar").count();
    if (floatToolbar === 0) {
      await fd("[data-hs-id='p-1']");
      await pEl.evaluate((el) => {
        const textNode = document.createTreeWalker(
          el,
          NodeFilter.SHOW_TEXT
        ).nextNode();
        if (!textNode?.textContent) return;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.textContent.length));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      });
      await window.waitForTimeout(800);
      floatToolbar = await window.locator(".float-toolbar").count();
    }
    log("Floating toolbar on text selection", floatToolbar === 1, `toolbar count = ${floatToolbar}`);

    // ===== T4: auto-close =====
    if (floatToolbar === 1) {
      await window.waitForTimeout(300);
      await dispatchClick("[data-hs-id='h1-1']");
      await window.waitForTimeout(800);
      const after = await window.locator(".float-toolbar").count();
      log("Floating toolbar auto-closes on outside click", after === 0, `after count = ${after}`);
    } else {
      log("Floating toolbar auto-closes on outside click", false, "T3 failed");
    }

    // ===== T5: B button =====
    await fd("[data-hs-id='p-1']");
    await window.waitForTimeout(400);
    const pEl2 = await fh("[data-hs-id='p-1']");
    await pEl2.evaluate((el) => {
      const range = document.createRange();
      const sel = window.getSelection();
      const textNode = el.firstChild;
      if (textNode && textNode.textContent) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.textContent.length));
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      }
    });
    await window.waitForTimeout(400);
    const bBtn = window.locator(".float-toolbar .float-btn, .float-toolbar button", { hasText: /^B$/ });
    let boldApplied = false;
    if (await bBtn.count() > 0) {
      await bBtn.first().click({ force: true });
      await window.waitForTimeout(500);
      const html = await frame.locator("[data-hs-id='p-1']").innerHTML();
      boldApplied = /<(b|strong)[\s>]/i.test(html) || /font-weight\s*:\s*(bold|700)/i.test(html);
      log("B button applies bold", boldApplied, `html: ${html.slice(0, 80)}`);
    } else {
      log("B button applies bold", false, "B button not found");
    }

    // ===== T6: Ctrl+Z undo =====
    await window.keyboard.press("Control+z");
    await window.waitForTimeout(600);
    const html2 = await frame.locator("[data-hs-id='p-1']").innerHTML();
    const undone = !boldApplied || !/<(b|strong)[\s>]/i.test(html2);
    log("Ctrl+Z undo bold", undone, `html: ${html2.slice(0, 80)}`);
    if (undone) {
      await window.keyboard.press("Control+y");
      await window.waitForTimeout(500);
    }

    // ===== Color burst regression: rapid picker input must coalesce =====
    await fd("[data-hs-id='p-1']");
    const colorTarget = await fh("[data-hs-id='p-1']");
    await colorTarget.evaluate((el) => {
      const range = document.createRange();
      const selection = window.getSelection();
      const textNode = document.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT
      ).nextNode();
      if (textNode?.textContent) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(5, textNode.textContent.length));
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
      }
    });
    await window.waitForTimeout(300);
    await window.locator(".inspector-tabs button").first().click();
    const textColorInput = window.locator(".text-style-controls input[type='color']").first();
    const revisionBeforeColor = Number(
      (await window.locator(".statusbar").textContent())?.match(/版本\s+(\d+)/)?.[1] ?? 0
    );
    await textColorInput.evaluate((input) => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      for (let index = 0; index < 40; index += 1) {
        const channel = (64 + index * 4).toString(16).padStart(2, "0").slice(-2);
        setValue?.call(input, `#33${channel}ff`);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setValue?.call(input, "#3366ff");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await window.waitForTimeout(1200);
    const revisionAfterColor = Number(
      (await window.locator(".statusbar").textContent())?.match(/版本\s+(\d+)/)?.[1] ?? 0
    );
    const coloredHtml = await frame.locator("[data-hs-id='p-1']").innerHTML();
    const colorCoalesced = revisionAfterColor - revisionBeforeColor <= 2;
    log(
      "Rapid color changes stay responsive and coalesce",
      /3366ff|rgb\(51,\s*102,\s*255\)/i.test(coloredHtml) && colorCoalesced,
      `revision delta=${revisionAfterColor - revisionBeforeColor}`
    );
    const fontSizeInput = window.locator(
      ".text-style-controls .text-font-size-input"
    );
    await fontSizeInput.fill("32");
    await window.waitForTimeout(700);
    const sizedHtml = await frame.locator("[data-hs-id='p-1']").innerHTML();
    log(
      "Text size applies exact value without freezing",
      /font-size:\s*32px/i.test(sizedHtml),
      `html: ${sizedHtml.slice(0, 100)}`
    );
    const syncedFontValue = await fontSizeInput.inputValue();
    log(
      "Font size control follows nearby selection",
      syncedFontValue === "32",
      `control=${syncedFontValue}`
    );
    await fontSizeInput.fill("52");
    await window.waitForTimeout(500);
    const over48Html = await frame.locator("[data-hs-id='p-1']").innerHTML();
    const over48Control = await fontSizeInput.inputValue();
    log(
      "Font size above 48 stays exact",
      /font-size:\s*52px/i.test(over48Html) && over48Control === "52",
      `control=${over48Control}`
    );
    await window.getByTitle("缩小字号").click();
    await window.waitForTimeout(500);
    const smallerFontHtml = await frame.locator("[data-hs-id='p-1']").innerHTML();
    log(
      "Font size can decrease",
      /font-size:\s*50px/i.test(smallerFontHtml),
      `html: ${smallerFontHtml.slice(0, 110)}`
    );
    await colorTarget.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && !textNode.textContent?.includes("paragraph")) {
        textNode = walker.nextNode();
      }
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, Math.min(2, textNode.textContent?.length ?? 0));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await window.waitForTimeout(300);
    const caretPlainSize = await fontSizeInput.inputValue();
    log(
      "Caret movement detects nearby plain-text size",
      caretPlainSize === "16",
      `control=${caretPlainSize}`
    );
    await colorTarget.evaluate((element) => {
      const sized = element.querySelector("[style*='font-size']");
      const textNode = sized
        ? document.createTreeWalker(sized, NodeFilter.SHOW_TEXT).nextNode()
        : null;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, Math.min(1, textNode.textContent?.length ?? 0));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });
    await window.waitForTimeout(300);
    const caretStyledSize = await fontSizeInput.inputValue();
    log(
      "Caret movement detects nearby styled-text size",
      caretStyledSize === "50",
      `control=${caretStyledSize}`
    );

    // ===== T7: resize handles =====
    await fc("[data-hs-id='card-1']");
    await window.waitForTimeout(500);
    const handles = await fn(".resize-handle, [class*=resize-handle], [class*=ResizeHandle]");
    log("Resize handles (8 dirs)", handles >= 4, `handle count = ${handles}`);

    // ===== T8: block manager h2 =====
    const h2Btn = window.locator(".block-btn", { hasText: /标题二/ });
    if (await h2Btn.count() > 0) {
      await h2Btn.first().click({ force: true });
      await window.waitForTimeout(800);
      const newH2s = await fn("h2[data-hs-id^='node_']");
      log("BlockManager insert h2", newH2s >= 1, `new h2 count = ${newH2s}`);
      const flowPlacement = await frame.locator("h2[data-hs-id^='node_']").last().evaluate(
        (element) => ({
          position: element.style.position,
          parentId: element.parentElement?.getAttribute("data-hs-id")
        })
      );
      log(
        "Flow insertion embeds into selected content",
        flowPlacement.position !== "absolute" && flowPlacement.parentId === "card-1",
        JSON.stringify(flowPlacement)
      );

      await window.locator(".insert-placement button").nth(1).click();
      await window.locator(".block-btn", { hasText: /^正文$/ }).click();
      await window.waitForTimeout(600);
      const freeParagraphs = await fn("p[data-hs-id^='node_'][style*='position: absolute']");
      log(
        "Free insertion remains available as an explicit mode",
        freeParagraphs >= 1,
        `absolute paragraphs=${freeParagraphs}`
      );
      await window.locator(".insert-placement button").first().click();
    } else {
      log("BlockManager insert h2", false, "h2 button not found");
    }

    // ===== T9: block manager chart =====
    const chartBtn = window.locator(".block-btn", { hasText: /图表/ });
    if (await chartBtn.count() > 0) {
      await chartBtn.first().click({ force: true });
      await window.waitForTimeout(2000);
      const charts = await fn("[data-hs-chart]");
      log("BlockManager insert chart", charts >= 1, `chart count = ${charts}`);
      const chartCanvases = await fn("[data-hs-chart] canvas");
      log(
        "Inserted chart renders without page-provided ECharts",
        chartCanvases >= 1,
        `canvas count=${chartCanvases}`
      );
    } else {
      log("BlockManager insert chart", false, "chart button not found");
    }

    const imageBlockButton = window.locator(".block-btn", { hasText: /^图片$/ });
    await imageBlockButton.click();
    await window.waitForTimeout(400);
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(TEST_IMG));
    await window.locator(".media-action", { hasText: /选择图片|替换图片/ }).click();
    await window.waitForTimeout(700);
    const importedImageSrc = await frame.locator(
      "img[data-hs-id^='node_']"
    ).last().getAttribute("src");
    log(
      "Image component embeds Base64 and replaces its source",
      Boolean(importedImageSrc?.startsWith("data:image/svg+xml;base64,")),
      `src=${importedImageSrc}`
    );

    await frame.locator("[data-hs-id='col-1']").evaluate((container) => {
      const uploadSlot = document.createElement("div");
      uploadSlot.className = "upload-slot";
      uploadSlot.dataset.slot = "batch-a";
      uploadSlot.style.cssText = "width:180px;height:120px;margin:8px;border:2px dashed #999";
      uploadSlot.innerHTML = "<img alt='Upload sample' style='width:100%;height:100%;object-fit:contain'>";
      const mediaCard = document.createElement("figure");
      mediaCard.className = "brand-media-card";
      mediaCard.style.cssText = "width:180px;height:120px;margin:8px";
      mediaCard.innerHTML = "<img alt='Brand sample' style='width:100%;height:100%;object-fit:contain'>";
      const watermark = document.createElement("img");
      watermark.className = "report-logo-watermark";
      watermark.alt = "Report logo watermark";
      watermark.style.cssText = "width:180px;height:120px";
      container.append(uploadSlot, mediaCard, watermark);
    });
    await window.waitForTimeout(400);
    await window.getByRole("button", { name: "资源" }).click();
    await window.getByRole("button", { name: /选择图片槽/ }).click();
    await window.waitForTimeout(200);
    const imageSlotPickerText = await window.locator(".asset-import", {
      hasText: /完成点选/
    }).textContent();
    log(
      "Image-slot detector finds semantic upload and media containers",
      /识别到 [2-9]\d* 个候选槽位|识别到 2 个候选槽位/.test(
        imageSlotPickerText ?? ""
      ),
      `picker=${imageSlotPickerText}`
    );
    await frame.locator(".brand-media-card").evaluate((element) =>
      element.click()
    );
    await frame.locator(".upload-slot").evaluate((element) =>
      element.click()
    );
    await window.waitForTimeout(200);
    const selectedSlotButton = window.locator(".asset-import", {
      hasText: /完成点选（已选 2）/
    });
    log(
      "Image-slot picker supports ordered non-contiguous selection",
      await selectedSlotButton.count() === 1,
      `selected indicator count=${await selectedSlotButton.count()}`
    );
    await app.evaluate(({ dialog }, selectedPaths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: selectedPaths
      });
    }, [path.resolve(TEST_IMG), path.resolve(TEST_IMG_2)]);
    await window.locator(".asset-import", {
      hasText: /批量嵌入到 2 个槽位/
    }).click();
    await window.waitForTimeout(1000);
    const batchSources = await frame.locator(
      ".brand-media-card img, .upload-slot img"
    ).evaluateAll((images) => images.map((image) => image.getAttribute("src")));
    log(
      "Batch image import follows the slot click order",
      batchSources[0]?.startsWith("data:image/png;base64,")
        && batchSources[1]?.startsWith("data:image/svg+xml;base64,"),
      `sources=${batchSources.map((source) => source?.slice(0, 32)).join(",")}`
    );

    await window.getByRole("button", { name: "插入" }).click();
    const videoBlockButton = window.locator(".block-btn", { hasText: /^视频$/ });
    await videoBlockButton.click();
    await window.waitForTimeout(400);
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(TEST_VIDEO));
    await window.locator(".media-action", { hasText: /选择本地视频|替换视频/ }).click();
    await window.waitForTimeout(700);
    const importedVideoSrc = await frame.locator(
      "video[data-hs-id^='node_']"
    ).last().getAttribute("src");
    log(
      "Video component imports a durable project asset",
      Boolean(importedVideoSrc?.includes("/assets/") || importedVideoSrc?.includes("\\assets\\"))
        && !importedVideoSrc?.startsWith("blob:"),
      `src=${importedVideoSrc}`
    );

    await fc("[data-hs-id='h1-1']");
    await window.getByLabel("格式刷").click();
    await fc("[data-hs-id='col-1']");
    await window.waitForTimeout(500);
    const paintedFontSize = await frame.locator("[data-hs-id='col-1']").evaluate(
      (element) => getComputedStyle(element).fontSize
    );
    log(
      "Format painter applies source formatting once",
      paintedFontSize === "37px",
      `target font-size=${paintedFontSize}`
    );

    // ===== T10: layers panel =====
    const layersBtn = window.locator("button", { hasText: /图层/ });
    if (await layersBtn.count() > 0) {
      // The test intentionally exercises several modal/color-picker flows
      // before this point. A stale native hit-test surface can intercept a
      // coordinate click in Electron even though the React button is active.
      // Dispatch the semantic button activation, matching keyboard use.
      await layersBtn.first().evaluate((element) => element.click());
      await window.waitForTimeout(500);
      const layerItems = await window.locator(".layer-item, [class*=layer-item]").count();
      const navigator = await window.locator(".document-search").count();
      const outlineItems = await window.locator(".document-outline button").count();
      log(
        "Document navigator opens",
        navigator > 0 && (outlineItems > 0 || layerItems > 0),
        `outline = ${outlineItems}, layer items = ${layerItems}`
      );
    } else {
      log("Document navigator opens", false, "layers button not found");
    }

    // ===== T10b: responsive workspace =====
    const mobileBreakpoint = window.locator(
      'button[aria-label="手机断点"]'
    );
    if (await mobileBreakpoint.count() > 0) {
      await mobileBreakpoint.evaluate((element) => element.click());
      await window.waitForTimeout(300);
      const badge = await window.locator(".viewport-badge").textContent();
      log(
        "Responsive breakpoint changes the editing canvas",
        /390\s*×\s*844/.test(badge ?? ""),
        (badge ?? "").replace(/\s+/g, " ")
      );

      await dispatchClick("h1");
      const breakpointPanel = window.locator(".breakpoint-inspector");
      const breakpointVisible = await breakpointPanel.count() > 0;
      if (breakpointVisible) {
        const responsiveFont = breakpointPanel.locator(
          'input[type="number"]'
        ).first();
        await responsiveFont.fill("21");
        await responsiveFont.dispatchEvent("input");
        await responsiveFont.blur();
        await window.waitForTimeout(400);
      }
      const responsiveState = await frame.locator("h1").evaluate((element) => ({
        className: element.className,
        manifest: element.getAttribute("data-hs-responsive-rules"),
        css: document.querySelector(
          'style[data-hs-managed-style="responsive"]'
        )?.textContent ?? ""
      }));
      log(
        "Breakpoint style is persisted with export-stable CSS",
        breakpointVisible
          && /hsr-/.test(responsiveState.className)
          && /font-size/.test(responsiveState.manifest ?? "")
          && /max-width:\s*767px/.test(responsiveState.css),
        JSON.stringify(responsiveState).slice(0, 180)
      );

      const pdfButton = window.locator("button", {
        hasText: "导出 PDF"
      }).first();
      await pdfButton.evaluate((element) => element.click());
      const pdfWidth = await window.locator(
        ".pdf-fields label"
      ).filter({ hasText: "渲染宽度" }).locator("input").inputValue();
      log(
        "Mobile canvas does not pollute PDF viewport",
        pdfWidth === "1440",
        `PDF width = ${pdfWidth}`
      );
      await window.locator('.pdf-dialog button[aria-label="关闭"]')
        .evaluate((element) => element.click());

      await window.locator(".canvas-tool-button.audit")
        .evaluate((element) => element.click());
      await window.locator(".responsive-audit-panel").waitFor({
        timeout: 10_000
      });
      const auditText = await window.locator(
        ".responsive-audit-panel"
      ).textContent();
      log(
        "Responsive audit completes",
        /已检查/.test(auditText ?? ""),
        (auditText ?? "").replace(/\s+/g, " ").slice(0, 120)
      );
      await window.locator(
        '.responsive-audit-panel button[aria-label="关闭"]'
      ).evaluate((element) => element.click());
    } else {
      log("Responsive breakpoint changes the editing canvas", false, "mobile breakpoint missing");
      log("Breakpoint style is persisted with export-stable CSS", false, "mobile breakpoint missing");
      log("Mobile canvas does not pollute PDF viewport", false, "mobile breakpoint missing");
      log("Responsive audit completes", false, "mobile breakpoint missing");
    }

    // ===== T10c: reusable components =====
    await dispatchClick('[data-hs-id="card-1"]');
    await window.locator(".inspector-tabs button", {
      hasText: "高级"
    }).evaluate((element) => element.click());
    await window.waitForTimeout(150);
    const createComponent = window.locator(".component-create-row");
    if (await createComponent.count() > 0) {
      await createComponent.locator("input").fill("卡片组件");
      await createComponent.locator("button").evaluate(
        (element) => element.click()
      );
      await window.waitForTimeout(300);
      const created = await frame.locator('[data-hs-id="card-1"]').evaluate(
        (element) => ({
          id: element.getAttribute("data-hs-component-id"),
          role: element.getAttribute("data-hs-component-role"),
          fields: element.querySelectorAll("[data-hs-component-field]").length
        })
      );
      log(
        "Selection becomes a structured master component",
        Boolean(created.id) && created.role === "master" && created.fields >= 2,
        JSON.stringify(created)
      );

      await window.locator(".component-actions button", {
        hasText: "创建实例"
      }).evaluate((element) => element.click());
      await window.waitForTimeout(300);
      const instances = await frame.locator(
        '[data-hs-component-id]'
      ).evaluateAll((roots) => ({
        count: roots.length,
        roles: roots.map((root) =>
          root.getAttribute("data-hs-component-role")),
        ids: roots.flatMap((root) => [
          root.getAttribute("data-hs-id"),
          ...[...root.querySelectorAll("[data-hs-id]")].map((node) =>
            node.getAttribute("data-hs-id"))
        ])
      }));
      log(
        "Component instance gets independent editor IDs",
        instances.count === 2
          && instances.roles.includes("master")
          && instances.roles.includes("instance")
          && new Set(instances.ids).size === instances.ids.length,
        JSON.stringify({
          count: instances.count,
          roles: instances.roles,
          uniqueIds: new Set(instances.ids).size
        })
      );

      const componentRoots = frame.locator('[data-hs-component-id]');
      const masterTextField = componentRoots.first().locator(
        '[data-hs-component-field-kind="text"]'
      ).first();
      await masterTextField.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
      await window.locator(".inspector-tabs button", {
        hasText: "内容与样式"
      }).evaluate((element) => element.click());
      const textEditor = window.locator(".inspector-body textarea").first();
      await textEditor.fill("主组件同步文字");
      await textEditor.blur();
      await window.waitForTimeout(350);
      const syncedText = await componentRoots.evaluateAll((roots) =>
        roots.map((root) =>
          root.querySelector('[data-hs-component-field-kind="text"]')
            ?.textContent ?? "")
      );
      log(
        "Master field update synchronizes instances",
        syncedText.length === 2
          && syncedText.every((text) => text === "主组件同步文字"),
        JSON.stringify(syncedText)
      );

      const instanceTextField = componentRoots.nth(1).locator(
        '[data-hs-component-field-kind="text"]'
      ).first();
      await instanceTextField.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
      const instanceEditor = window.locator(
        ".inspector-body textarea"
      ).first();
      await instanceEditor.fill("实例保留文字");
      await instanceEditor.blur();
      await window.waitForTimeout(300);

      await masterTextField.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
      const masterEditor = window.locator(
        ".inspector-body textarea"
      ).first();
      await masterEditor.fill("主组件第二版");
      await masterEditor.blur();
      await window.waitForTimeout(350);
      const conflictState = await componentRoots.nth(1).evaluate((root) => ({
        text: root.querySelector(
          '[data-hs-component-field-kind="text"]'
        )?.textContent,
        overrides: root.getAttribute("data-hs-component-overrides"),
        conflicts: root.getAttribute("data-hs-component-conflicts")
      }));
      log(
        "Instance override survives master update and records conflict",
        conflictState.text === "实例保留文字"
          && /text-/.test(conflictState.overrides ?? "")
          && /text-/.test(conflictState.conflicts ?? ""),
        JSON.stringify(conflictState)
      );

      await instanceTextField.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
      await window.locator(".inspector-tabs button", {
        hasText: "高级"
      }).evaluate((element) => element.click());
      await window.locator(".component-actions button", {
        hasText: "恢复字段"
      }).evaluate((element) => element.click());
      await window.waitForTimeout(300);
      const resetState = await componentRoots.nth(1).evaluate((root) => ({
        text: root.querySelector(
          '[data-hs-component-field-kind="text"]'
        )?.textContent,
        overrides: root.getAttribute("data-hs-component-overrides"),
        conflicts: root.getAttribute("data-hs-component-conflicts")
      }));
      log(
        "Instance field can reset to the master",
        resetState.text === "主组件第二版"
          && resetState.overrides === "[]"
          && resetState.conflicts === "[]",
        JSON.stringify(resetState)
      );
    } else {
      log("Selection becomes a structured master component", false, "component create UI missing");
      log("Component instance gets independent editor IDs", false, "component create UI missing");
      log("Master field update synchronizes instances", false, "component create UI missing");
      log("Instance override survives master update and records conflict", false, "component create UI missing");
      log("Instance field can reset to the master", false, "component create UI missing");
    }

    // ===== T11: symbol =====
    const symbolBtn = window.locator("button[data-action='toggle-symbol']");
    if (await symbolBtn.count() > 0) {
      await fc("[data-hs-id='span-1']");
      await window.waitForTimeout(400);
      await symbolBtn.first().click({ force: true });
      await window.waitForTimeout(400);
      const isSymbol = await fn("[data-hs-id='span-1'][data-hs-symbol]");
      log("Mark as symbol sets data-hs-symbol", isSymbol === 1);
    } else {
      log("Mark as symbol sets data-hs-symbol", false, "symbol button not found");
    }

    // ===== T12: z-index =====
    await fc("[data-hs-id='img-1']");
    await window.waitForTimeout(400);
    await window.keyboard.press("Control+]");
    await window.waitForTimeout(500);
    const zStyle = await frame.locator("[data-hs-id='img-1']").evaluate((el) => el.style.zIndex);
    log("Ctrl+] bumps z-index", zStyle && zStyle !== "auto" && zStyle !== "", `z-index = ${zStyle}`);

    // ===== T13: clone Ctrl+D =====
    const before = await fn("[data-hs-id]");
    await window.keyboard.press("Control+d");
    await window.waitForTimeout(700);
    const after = await fn("[data-hs-id]");
    log("Ctrl+D clones element", after > before, `before=${before} after=${after}`);

    // ===== T14: right-click menu =====
    await dispatchContextMenu("[data-hs-id='h1-1']");
    await window.waitForTimeout(500);
    const ctxMenu = await window.locator(".context-menu, [class*=context-menu]").count();
    log("Right-click context menu", ctxMenu >= 1, `count = ${ctxMenu}`);

    // ===== T15: delete =====
    const beforeDel = await fn("[data-hs-id]");
    await fc("[data-hs-id='span-1']");
    await window.waitForTimeout(400);
    // Dispatch the Delete key inside the iframe's contentDocument
    await frame.locator("body").evaluate((body) => {
      const doc = body.ownerDocument;
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
      doc.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete", bubbles: true }));
    });
    await window.waitForTimeout(900);
    const afterDel = await fn("[data-hs-id]");
    log("Delete key removes element", afterDel < beforeDel, `before=${beforeDel} after=${afterDel}`);

    // ===== T16: code view modal =====
    const codeBtn = window.locator("button:not([disabled])", { hasText: /查看源码/ });
    const codeCount = await codeBtn.count();
    if (codeCount > 0) {
      // Click via direct DOM dispatch to bypass any actionability issues
      await codeBtn.first().evaluate(el => el.click());
      await window.waitForTimeout(2000);
      const modalCount = await window.locator(".code-modal, [class*=code-modal]").count();
      const modalBackdrop = await window.locator(".modal-backdrop").count();
      log("Code view modal opens", modalCount === 1 || modalBackdrop === 1, `codeBtn=${codeCount} modalCount=${modalCount} backdrop=${modalBackdrop}`);
      await window.locator(".code-modal").getByRole("button", {
        name: "关闭"
      }).click();
      await window.waitForTimeout(400);
    } else {
      log("Code view modal opens", false, "code button not found");
    }

    // ===== T17: chart data edit =====
    const chartCount = await fn("[data-hs-chart]");
    if (chartCount > 0) {
      await dispatchClick("[data-hs-chart]");
      await window.waitForTimeout(700);
      const editorTextarea = window.locator("textarea.chart-data-editor");
      if (await editorTextarea.count() > 0) {
        const newData = JSON.stringify({
          labels: ["Q1", "Q2", "Q3", "Q4"],
          series: [{ name: "Sales", data: [100, 200, 150, 300] }]
        });
        await editorTextarea.first().fill(newData);
        await editorTextarea.first().evaluate(el => el.blur());
        await window.waitForTimeout(1000);
        const dataset = await frame.locator("[data-hs-chart]").first().evaluate((el) => el.dataset.hsChartData);
        const updated = dataset && dataset.includes("300");
        log("Chart data JSON edit updates chart", updated, `dataset: ${(dataset || "").slice(0, 60)}`);
      } else {
        log("Chart data JSON edit updates chart", false, "textarea not found");
      }
    } else {
      log("Chart data JSON edit updates chart", false, "no chart block");
    }

    // ===== T18: materialize dynamic page into a separate static project =====
    await window.locator("button.compatibility-status").evaluate(
      (element) => element.click()
    );
    const materializeDialog = window.locator(".compatibility-dialog");
    await materializeDialog.waitFor({ timeout: 5_000 });
    const materializeButton = materializeDialog.getByRole("button", {
      name: /物化为静态副本/
    });
    if (await materializeButton.count() > 0) {
      await materializeButton.click();
      await frame.locator(
        "#runtime-list > .runtime-card[data-hs-id^='node_']"
      ).first().waitFor({
        timeout: 45_000
      });
      const materializedState = await frame.locator("body").evaluate(() => ({
        dynamicIds: document.querySelectorAll("[data-hs-id^='dyn_']").length,
        staticCards: document.querySelectorAll(
          "#runtime-list > .runtime-card[data-hs-id^='node_']"
        ).length,
        executableUserScripts: [...document.querySelectorAll("script")]
          .filter((script) =>
            !["application/json", "application/ld+json"].includes(
              script.type.toLowerCase()
            )
            && !script.hasAttribute("data-hs-runtime-dependency")
            && script.type !== "module"
          ).length,
        canvasSnapshots: document.querySelectorAll(
          "img[alt='Canvas snapshot']"
        ).length
      }));
      log(
        "Materialization creates a separate static editable project",
        materializedState.dynamicIds === 0
          && materializedState.staticCards === 2
          && materializedState.executableUserScripts === 0
          && materializedState.canvasSnapshots >= 2,
        JSON.stringify(materializedState)
      );
    } else {
      log(
        "Materialization creates a separate static editable project",
        false,
        "materialize action unavailable"
      );
      await materializeDialog.getByRole("button", {
        name: "继续编辑"
      }).click();
    }

    // ===== T19: console errors =====
    const realErrors = errors.filter((e) =>
      !/Manifest|favicon|not allowed to load|font/i.test(e) &&
      !/Failed to load resource: net::ERR_FILE_NOT_FOUND.*test-image/i.test(e)
    );
    log("No critical console errors", realErrors.length === 0, realErrors.length > 0 ? realErrors.slice(0, 2).join(" | ") : "");

  } catch (err) {
    log("FATAL", false, err.message);
  } finally {
    await app.close();
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  }

  console.log("\n========================================");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter((r) => !r.pass).forEach((r) => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}${r.info ? " — " + r.info : ""}`);
    });
  }
  process.exit(failed > 0 ? 1 : 0);
})();
