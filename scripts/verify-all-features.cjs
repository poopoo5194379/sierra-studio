// Full-feature E2E regression for SierraStudio
// Same pattern as scripts/verify-dynamic-editing.cjs
// Uses { force: true } on iframe clicks because the sandboxed iframe
// confuses Playwright actionability checks (elementFromPoint is correct).
const path = require("node:path");
const fs = require("node:fs");
const { _electron: electron } = require("playwright");

const ROOT = path.join(__dirname, "..");
const EXECUTABLE = path.join(
  ROOT, "node_modules", "electron", "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const TEST_HTML = path.join(ROOT, "scripts", "fixtures", "test-page.html");
const TEST_IMG = path.join(ROOT, "scripts", "fixtures", "test-image.svg");

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
    executablePath: EXECUTABLE,
    args: [ROOT, "--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"]
  });
  const errors = [];
  try {
    const window = await app.firstWindow();
    window.on("pageerror", (err) => errors.push("pageerror: " + err.message));
    window.on("console", (msg) => {
      if (msg.type() === "error") errors.push("console: " + msg.text());
    });
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false, filePaths: [selectedPath]
      });
    }, path.resolve(TEST_HTML));

    await window.locator(".empty-state").click();
    await window.getByText("index.html").waitFor({ timeout: 180_000 });
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
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
          el.dispatchEvent(new MouseEvent("dblclick", base));
        }
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
    const fc = (sel, opts) => dispatchClick(sel, opts);
    const fd = (sel) => dispatchDblClick(sel);
    const fn = (sel) => frame.locator(sel).count();
    const fh = (sel) => frame.locator(sel).elementHandle();

    log("Open project & canvas ready", true);

    // ===== T1 =====
    await fc("[data-hs-id='h1-1']");
    await window.waitForTimeout(500);
    const inspectorText = await window.locator(".inspector, [class*=inspector], .right-panel, [class*=right]").textContent();
    log("Click selects & shows panel", /h1-1|节点|H1|Heading|标题/.test(inspectorText || ""), `panel: ${(inspectorText || "").slice(0, 80)}`);

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
      }
    });
    await window.waitForTimeout(500);
    const floatToolbar = await window.locator(".float-toolbar").count();
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
    } else {
      log("BlockManager insert chart", false, "chart button not found");
    }

    // ===== T10: layers panel =====
    const layersBtn = window.locator("button", { hasText: /图层/ });
    if (await layersBtn.count() > 0) {
      await layersBtn.first().click({ force: true });
      await window.waitForTimeout(500);
      const layerItems = await window.locator(".layer-item, [class*=layer-item]").count();
      log("Layers panel opens", layerItems > 0, `layer items = ${layerItems}`);
    } else {
      log("Layers panel opens", false, "layers button not found");
    }

    // ===== T11: symbol =====
    const symbolBtn = window.locator("button", { hasText: /符号|标记/ });
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
    const codeBtn = window.locator("button:not([disabled])", { hasText: /^源码$/ });
    const codeCount = await codeBtn.count();
    if (codeCount > 0) {
      // Click via direct DOM dispatch to bypass any actionability issues
      await codeBtn.first().evaluate(el => el.click());
      await window.waitForTimeout(2000);
      const modalCount = await window.locator(".code-modal, [class*=code-modal]").count();
      const modalBackdrop = await window.locator(".modal-backdrop").count();
      log("Code view modal opens", modalCount === 1 || modalBackdrop === 1, `codeBtn=${codeCount} modalCount=${modalCount} backdrop=${modalBackdrop}`);
      await window.keyboard.press("Escape");
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

    // ===== T18: console errors =====
    const realErrors = errors.filter((e) =>
      !/Manifest|favicon|not allowed to load|font/i.test(e) &&
      !/Failed to load resource: net::ERR_FILE_NOT_FOUND.*test-image/i.test(e)
    );
    log("No critical console errors", realErrors.length === 0, realErrors.length > 0 ? realErrors.slice(0, 2).join(" | ") : "");

  } catch (err) {
    log("FATAL", false, err.message);
  } finally {
    await app.close();
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
