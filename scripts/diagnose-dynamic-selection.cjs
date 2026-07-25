const path = require("node:path");
const { _electron: electron } = require("playwright");

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
    // Give user scripts time to build dynamic DOM
    await window.waitForTimeout(3000);

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');

    // 1) Statistics: how many elements have data-hs-id vs not
    const stats = await frame.locator("body").evaluate(() => {
      const all = [...document.body.querySelectorAll("*")]
        .filter((el) => !el.closest("[data-hs-overlay]") && el.tagName !== "SCRIPT" && el.tagName !== "STYLE");
      const withId = all.filter((el) => el.hasAttribute("data-hs-id"));
      const withoutId = all.filter((el) => !el.hasAttribute("data-hs-id"));
      // group missing by nearest ancestor WITH id
      const groups = {};
      for (const el of withoutId) {
        const anchor = el.parentElement?.closest("[data-hs-id]");
        const key = anchor
          ? `${anchor.tagName.toLowerCase()}#${anchor.id || "-"}.${anchor.className && typeof anchor.className === "string" ? anchor.className.split(/\s+/)[0] : ""}`
          : "(none)";
        groups[key] = (groups[key] || 0) + 1;
      }
      const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 15);
      return {
        total: all.length,
        withId: withId.length,
        withoutId: withoutId.length,
        runtimePresent: Boolean(document.querySelector("[data-hs-overlay]")),
        topMissingGroups: top
      };
    });

    // 2) Click probes: click centers of a few dynamic + static elements and
    //    report what data-hs-id chain the click resolves to
    const probeSelectors = [
      "#rankTable tr:nth-child(2)",          // static? table rows
      "#hotGrid > *:first-child",            // dynamic card
      "#kolGrid > *:first-child",            // dynamic card
      "#sentimentGrid > *:first-child",      // dynamic
      "#productGrid > *:first-child",        // dynamic
      "#volShareTable tr:nth-child(2)",      // dynamic table content
      ".sticky-nav, #stickyNav",             // static nav
      "#sec-m1 h2, #sec-m1 .sec-title, #sec-m1 *"  // static heading
    ];
    const probes = [];
    for (const selector of probeSelectors) {
      const info = await frame.locator("body").evaluate((body, sel) => {
        const el = document.querySelector(sel);
        if (!el) return { sel, found: false };
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const closestId = hit ? hit.closest("[data-hs-id]") : null;
        const describe = (n) => n
          ? `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${typeof n.className === "string" && n.className ? "." + n.className.split(/\s+/).slice(0, 2).join(".") : ""}`
          : null;
        return {
          sel,
          found: true,
          targetHasId: el.hasAttribute("data-hs-id"),
          target: describe(el),
          hit: describe(hit),
          hitHasId: hit ? hit.hasAttribute("data-hs-id") : null,
          closestIdElement: describe(closestId),
          closestIsBody: closestId === document.body,
          rectW: Math.round(rect.width),
          rectH: Math.round(rect.height)
        };
      }, selector);
      probes.push(info);
    }

    // 3) Actually click one dynamic card through real mouse and observe selection panel
    const clickProbe = async (selector) => {
      const exists = await frame.locator(selector).count();
      if (exists === 0) return { selector, exists: false };
      const locator = frame.locator(selector).first();
      await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await window.waitForTimeout(200);
      const inner = await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      });
      const iframeBox = await window.locator('iframe[title="HTML editing canvas"]').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          vw: el.clientWidth, vh: el.clientHeight
        };
      });
      const sx = iframeBox.x + (inner.x + inner.w / 2) * (iframeBox.w / iframeBox.vw);
      const sy = iframeBox.y + (inner.y + inner.h / 2) * (iframeBox.h / iframeBox.vh);
      await window.mouse.click(sx, sy);
      await window.waitForTimeout(400);
      const panel = await window.locator(".right-panel").innerText().catch(() => "(no panel)");
      const overlayInfo = await frame.locator("body").evaluate(() => {
        const overlay = document.querySelector("[data-hs-overlay]");
        if (!overlay) return null;
        const boxes = [...overlay.children].filter((child) =>
          !child.hasAttribute("data-hs-resize-handle")
          && child.style.display !== "none"
        );
        return boxes.map((box) => ({
          left: box.style.left, top: box.style.top,
          width: box.style.width, height: box.style.height
        }));
      });
      return {
        selector,
        exists: true,
        selectionPanelFirstLine: panel.split("\n").slice(0, 3).join(" | "),
        overlayBoxes: overlayInfo
      };
    };

    const clickResults = [];
    clickResults.push(await clickProbe("#hotGrid > *:first-child"));
    clickResults.push(await clickProbe("#kolGrid > *:first-child"));
    clickResults.push(await clickProbe("#rankTable tbody tr:first-child td:first-child"));

    console.log(JSON.stringify({ stats, probes, clickResults, errors: errors.slice(0, 20) }, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
