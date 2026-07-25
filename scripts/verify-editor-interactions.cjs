const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const htmlPath = process.argv[2] || path.join(__dirname, "..", "examples", "demo.html");
  const imagePath = path.join(__dirname, "..", "examples", "insert-test.svg");
  const executablePath = path.join(
    __dirname, "..", "node_modules", "electron", "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [path.join(__dirname, "..")]
  });
  const errors = [];
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (options) => ({
        canceled: false,
        filePaths: [options.filters?.[0]?.name === "Images" ? paths.image : paths.html]
      });
    }, { html: path.resolve(htmlPath), image: imagePath });

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
    const clickBox = async (box, position) => {
      await window.mouse.click(
        box.x + (position?.x ?? box.width / 2),
        box.y + (position?.y ?? box.height / 2),
        { delay: 20 }
      );
    };

    const cards = frame.locator(".rank-card");
    const cardCount = await cards.count();
    let reordered = false;
    if (cardCount >= 2) {
      const beforeOrder = await cards.evaluateAll((items) =>
        items.slice(0, 2).map((item) => item.getAttribute("data-hs-id"))
      );
      const firstBox = await visualBox(cards.nth(0));
      const secondBox = await visualBox(cards.nth(1), false);
      await clickBox(firstBox);
      await window.locator(".selection-title code").waitFor();
      await window.mouse.move(
        firstBox.x + firstBox.width / 2,
        firstBox.y + firstBox.height / 2
      );
      await window.mouse.down();
      await window.mouse.move(
        secondBox.x + secondBox.width / 2,
        secondBox.y + secondBox.height / 2,
        { steps: 8 }
      );
      await window.mouse.up();
      await window.waitForTimeout(300);
      const afterOrder = await cards.evaluateAll((items) =>
        items.slice(0, 2).map((item) => item.getAttribute("data-hs-id"))
      );
      reordered = beforeOrder.join("|") !== afterOrder.join("|");
    }

    const firstPage = frame.locator(".page-inner").first();
    const firstPageBox = await visualBox(firstPage);
    await clickBox(firstPageBox, { x: 8, y: 8 });
    await window.getByRole("button", { name: "插入 / 替换图片" }).click();
    const pageBoxForInsert = await visualBox(firstPage, false);
    await clickBox(pageBoxForInsert, {
      x: Math.min(120, pageBoxForInsert.width / 3),
      y: Math.min(120, pageBoxForInsert.height / 3)
    });
    const insertedImage = frame.locator('img[style*="2147483000"]');
    await insertedImage.waitFor({ state: "attached" });
    const inserted = await insertedImage.evaluate((image) => ({
      zIndex: image.style.zIndex,
      parentClass: image.parentElement?.className,
      pageIndex: [...document.querySelectorAll(".page")].indexOf(image.closest(".page"))
    }));

    console.log(JSON.stringify({ cardCount, reordered, inserted, errors }, null, 2));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
