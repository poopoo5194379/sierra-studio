const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const htmlPath = process.argv[2] || path.join(__dirname, "..", "examples", "demo.html");
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
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, path.resolve(htmlPath));
    await window.locator(".empty-state").click();
    await window.getByText("index.html").waitFor({ timeout: 120_000 });

    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const visualBox = async (locator, scroll = true) => {
      if (scroll) {
        await locator.evaluate((element) => {
          element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        });
        await window.waitForTimeout(120);
      }
      const inner = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        };
      });
      const iframe = await window.locator('iframe[title="HTML editing canvas"]').evaluate(
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            viewportWidth: element.clientWidth,
            viewportHeight: element.clientHeight
          };
        }
      );
      return {
        x: iframe.x + inner.x * (iframe.width / iframe.viewportWidth),
        y: iframe.y + inner.y * (iframe.height / iframe.viewportHeight),
        width: inner.width * (iframe.width / iframe.viewportWidth),
        height: inner.height * (iframe.height / iframe.viewportHeight)
      };
    };
    const pointerClick = async (locator, options = {}) => {
      const box = await visualBox(locator);
      if (options.shift) await window.keyboard.down("Shift");
      await window.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
        {
          clickCount: options.clickCount ?? 1,
          delay: options.clickCount === 2 ? 80 : 20
        }
      );
      if (options.shift) await window.keyboard.up("Shift");
      return box;
    };

    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    const cards = frame.locator(".rank-card");
    await cards.first().waitFor({ timeout: 15_000 });
    if (await cards.count() < 2) {
      throw new Error("Fixture needs at least two .rank-card elements");
    }

    const textLeaf = frame.locator(".rank-title b").first();
    await pointerClick(textLeaf, { clickCount: 2 });
    await window.locator(".right-panel textarea").waitFor();
    await window.locator(".right-panel textarea").fill("可编辑文字验证");
    await window.locator(".right-panel h2").click();
    await window.waitForTimeout(200);
    const editedText = await textLeaf.textContent();

    await pointerClick(cards.nth(0));
    await pointerClick(cards.nth(1), { shift: true });
    await window.getByText("2 个对象").waitFor();
    await window.locator(".align-grid button").first().click();
    await window.waitForTimeout(300);
    const aligned = await cards.evaluateAll((items) => {
      const first = items[0].getBoundingClientRect();
      const second = items[1].getBoundingClientRect();
      return Math.abs(first.left - second.left) < 1;
    });

    const beforeMove = await pointerClick(cards.nth(0));
    await window.mouse.move(
      beforeMove.x + beforeMove.width / 2,
      beforeMove.y + beforeMove.height / 2
    );
    await window.mouse.down();
    await window.mouse.move(
      beforeMove.x + beforeMove.width / 2 + 42,
      beforeMove.y + beforeMove.height / 2 + 28,
      { steps: 5 }
    );
    await window.mouse.up();
    const afterMove = await visualBox(cards.nth(0), false);
    const moved = Boolean(
      afterMove
      && Math.abs(afterMove.x - beforeMove.x) > 30
      && Math.abs(afterMove.y - beforeMove.y) > 18
    );

    const handle = frame.locator("[data-hs-resize-handle]");
    const beforeResize = await visualBox(cards.nth(0), false);
    const handleBox = await visualBox(handle, false);
    await window.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    );
    await window.mouse.down();
    await window.mouse.move(handleBox.x + 35, handleBox.y + 25, { steps: 4 });
    await window.mouse.up();
    const afterResize = await visualBox(cards.nth(0), false);
    const resized = Boolean(
      afterResize
      && afterResize.width > beforeResize.width + 10
      && afterResize.height > beforeResize.height + 5
    );

    const viewport = await frame.locator("html").evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      snap: getComputedStyle(document.documentElement).scrollSnapType,
      behavior: getComputedStyle(document.documentElement).scrollBehavior
    }));

    console.log(JSON.stringify({
      editedText,
      aligned,
      moved,
      resized,
      viewport,
      beforeResize,
      afterResize,
      errors
    }, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
