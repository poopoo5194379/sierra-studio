const path = require("node:path");
const { _electron: electron } = require("playwright");

// End-to-end verification for editing script-generated (dynamic) DOM nodes:
// selection, free-drag, style persistence through the anchor manifest, and
// manifest replay when the page scripts regenerate their DOM.
(async () => {
  const htmlPath = process.argv[2]
    || "D:/桌面2/宏利6月_完整月报_含5月环比.html";
  const projectRoot = path.join(__dirname, "..");
  const executablePath = path.join(
    projectRoot, "node_modules", "electron", "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [
      projectRoot,
      ...(process.env.HS_NO_SANDBOX
        ? ["--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"]
        : [])
    ]
  });
  const errors = [];
  const result = {};
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(htmlPath));
    await window.locator(".empty-state").click();
    await window.getByText("index.html").waitFor({ timeout: 180_000 });
    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    await window.waitForTimeout(3000);

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');

    const visualBox = async (locator) => {
      await locator.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      });
      await window.waitForTimeout(150);
      const inner = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      });
      const iframe = await window.locator('iframe[title="HTML editing canvas"]').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, vw: element.clientWidth, vh: element.clientHeight };
      });
      return {
        x: iframe.x + inner.x * (iframe.w / iframe.vw),
        y: iframe.y + inner.y * (iframe.h / iframe.vh),
        w: inner.w * (iframe.w / iframe.vw),
        h: inner.h * (iframe.h / iframe.vh)
      };
    };

    // ---------- 1) select a dynamic card: expect card-sized overlay ----------
    const card = frame.locator("#hotGrid > *:first-child").first();
    const cardInfo = await card.evaluate((el) => ({
      hasId: el.hasAttribute("data-hs-id"),
      idPrefix: (el.getAttribute("data-hs-id") || "").slice(0, 4),
      w: Math.round(el.getBoundingClientRect().width)
    }));
    const box = await visualBox(card);
    await window.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
    await window.waitForTimeout(400);
    result.dynamicCardInfo = cardInfo;
    result.selectionPanel = (await window.locator(".right-panel").innerText())
      .split("\n").slice(0, 4).join(" | ");
    result.overlayAfterCardClick = await frame.locator("body").evaluate(() => {
      const overlay = document.querySelector("[data-hs-overlay]");
      const boxEl = [...overlay.children]
        .find((child) => !child.hasAttribute("data-hs-resize-handle") && child.style.display !== "none");
      return boxEl ? {
        width: Math.round(parseFloat(boxEl.style.width)),
        height: Math.round(parseFloat(boxEl.style.height))
      } : null;
    });

    // ---------- 2) free-move + drag ----------
    await window.getByRole("button", { name: "自由移动" }).click();
    await window.waitForTimeout(400);
    const beforeDrag = await card.evaluate((el) => ({
      position: getComputedStyle(el).position,
      left: el.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top
    }));
    const dragBox = await visualBox(card);
    await window.mouse.move(dragBox.x + dragBox.w / 2, dragBox.y + dragBox.h / 2);
    await window.mouse.down();
    await window.mouse.move(dragBox.x + dragBox.w / 2 + 55, dragBox.y + dragBox.h / 2 + 33, { steps: 6 });
    await window.mouse.up();
    await window.waitForTimeout(500);
    const afterDrag = await card.evaluate((el) => ({
      position: getComputedStyle(el).position,
      left: el.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top
    }));
    result.dragMoved = Math.abs(afterDrag.left - beforeDrag.left) > 30
      && Math.abs(afterDrag.top - beforeDrag.top) > 15;
    result.dragPosition = afterDrag.position;

    // ---------- 3) command persisted through anchor manifest ----------
    await window.getByText(/已保存 · Revision/).waitFor({ timeout: 15_000 });
    result.persistNotice = await window.locator(".statusbar").innerText();
    result.anchorManifest = await frame.locator("#hotGrid").evaluate((el) => {
      const raw = el.getAttribute("data-hs-dyn-patches");
      if (!raw) return null;
      const manifest = JSON.parse(raw);
      const first = Object.values(manifest)[0];
      return { paths: Object.keys(manifest), position: first?.styles?.position };
    });

    // ---------- 4) replay: wipe styles as scripts would, force re-render ----------
    result.replayWorks = await frame.locator("#hotGrid > *:first-child").evaluate((el) => {
      const cardEl = el;
      const expectedPosition = cardEl.style.position;
      const expectedLeft = cardEl.style.left;
      cardEl.style.position = "";
      cardEl.style.left = "";
      cardEl.style.top = "";
      return new Promise((resolve) => {
        setTimeout(() => {
          const bump = document.createElement("b");
          bump.textContent = "x";
          document.body.appendChild(bump);
          setTimeout(() => {
            resolve({
              restored: cardEl.style.position === expectedPosition
                && cardEl.style.left === expectedLeft,
              expectedPosition,
              actualPosition: cardEl.style.position
            });
            bump.remove();
          }, 600);
        }, 100);
      });
    });

    // ---------- 5) multi-select two dynamic cards ----------
    // Use an untouched grid for multi-select: after convert-free the first
    // card becomes absolutely positioned and overlaps reflowed siblings, so
    // stacked coordinates would hit the already-selected card.
    const cards = frame.locator("#productGrid > *");
    if (await cards.count() >= 2) {
      const b0 = await visualBox(cards.nth(0));
      await window.mouse.click(b0.x + b0.w / 2, b0.y + b0.h / 2);
      await window.waitForTimeout(300);
      result.multiStep1 = await window.locator(".selection-title code").innerText().catch(() => "(none)");
      const b1 = await visualBox(cards.nth(1));
      const hitInfo = await frame.locator("body").evaluate((body, point) => {
        const iframeRect = { x: point.x, y: point.y };
        void iframeRect;
        return null;
      }, b1).catch(() => null);
      void hitInfo;
      const innerB1 = await cards.nth(1).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const closest = hit?.closest("[data-hs-id]");
        const card = el;
        return {
          cx, cy,
          hitTag: hit?.tagName,
          hitIsInsideCard: card.contains(hit),
          closestId: closest?.getAttribute("data-hs-id")?.slice(0, 12),
          cardId: card.getAttribute("data-hs-id")?.slice(0, 12)
        };
      });
      result.multiShiftHit = innerB1;
      await window.keyboard.down("Shift");
      await window.mouse.click(b1.x + b1.w / 2, b1.y + b1.h / 2);
      await window.keyboard.up("Shift");
      await window.waitForTimeout(400);
      result.multiSelect = await window.locator(".selection-title code").innerText().catch(() => "(none)");
    }

    // ---------- 6) static regression: rank-table row is a component ----------
    const row = frame.locator("#rankTable tbody tr:first-child td:first-child").first();
    const rowBox = await visualBox(row);
    await window.mouse.click(rowBox.x + rowBox.w / 2, rowBox.y + rowBox.h / 2);
    await window.waitForTimeout(400);
    result.staticRowPanel = (await window.locator(".right-panel").innerText())
      .split("\n").slice(1, 4).join(" | ");

    // ---------- 7) chart container selectable (echarts inside dynamic region) ----------
    const chartContainer = frame.locator("#trendAll [_echarts_instance_]").first();
    if (await chartContainer.count() > 0) {
      const chartBox = await visualBox(chartContainer);
      await window.mouse.click(chartBox.x + chartBox.w / 2, chartBox.y + chartBox.h / 2);
      await window.waitForTimeout(400);
      result.chartPanel = await window.locator(".chart-editor-heading strong").innerText().catch(() => "(no chart panel)");
    } else {
      result.chartPanel = "(no echarts container found)";
    }

    result.errors = errors.slice(0, 10);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
