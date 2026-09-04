const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const sourceProjectDir = process.argv[2];
if (!sourceProjectDir) throw new Error("Expected a project directory");
const project = JSON.parse(fs.readFileSync(
  path.join(sourceProjectDir, "project.json"),
  "utf8"
));
const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "sierra-watermark-pages-")
);
fs.mkdirSync(path.join(userDataDir, "projects"), { recursive: true });
fs.cpSync(
  sourceProjectDir,
  path.join(userDataDir, "projects", project.projectId),
  { recursive: true }
);

async function snapshot(frame) {
  return frame.locator("body").evaluate(() => {
    const settings = JSON.parse(document.querySelector(
      "script[data-hs-watermark-manifest]"
    ).textContent);
    const id = settings.items[0].id;
    const marks = [...document.querySelectorAll(
      `[data-hs-watermark-id="${id}"]`
    )];
    return {
      settings,
      marks: marks.map((mark) => {
        const rect = mark.getBoundingClientRect();
        const page = mark.parentElement.parentElement;
        const pageRect = page.getBoundingClientRect();
        const style = getComputedStyle(mark);
        return {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          width: rect.width,
          height: rect.height,
          intersects: rect.right > pageRect.left
            && rect.left < pageRect.right
            && rect.bottom > pageRect.top
            && rect.top < pageRect.bottom
        };
      })
    };
  });
}

(async () => {
  const packagedExecutable = process.env.SIERRA_TEST_EXECUTABLE;
  const executablePath = packagedExecutable || path.join(
    root,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const app = await electron.launch({
    executablePath,
    args: packagedExecutable
      ? ["--no-sandbox", "--disable-gpu"]
      : [root, "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: userDataDir
    }
  });
  try {
    const window = await app.firstWindow();
    await window.locator(".activity-rail").waitFor();
    await window.evaluate((projectId) => {
      localStorage.setItem("sierra-studio:last-project", projectId);
    }, project.projectId);
    await window.reload();
    await window.locator(".runtime-state.ready").waitFor({
      timeout: 120_000
    });
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator("[data-hs-watermark-id]").first().waitFor();
    const before = await snapshot(frame);
    const id = before.settings.items[0].id;
    await frame.locator(`[data-hs-watermark-id="${id}"]`).first()
      .evaluate((mark) => {
        mark.dispatchEvent(new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 100,
          bubbles: true,
          cancelable: true
        }));
        window.dispatchEvent(new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          buttons: 1,
          clientX: 110,
          clientY: 108,
          bubbles: true,
          cancelable: true
        }));
        window.dispatchEvent(new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          clientX: 110,
          clientY: 108,
          bubbles: true,
          cancelable: true
        }));
      });
    await window.waitForTimeout(1_000);
    const after = await snapshot(frame);
    const handle = frame.locator(
      `[data-hs-watermark-id="${id}"] [data-hs-watermark-resize-handle]`
    ).first();
    await handle.waitFor();
    await handle.evaluate((target) => {
      const side = target.getAttribute("data-side");
      target.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 2,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 2,
        pointerType: "mouse",
        buttons: 1,
        clientX: side === "left" ? 80 : 120,
        clientY: 112,
        bubbles: true,
        cancelable: true
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 2,
        pointerType: "mouse",
        button: 0,
        clientX: side === "left" ? 80 : 120,
        clientY: 112,
        bubbles: true,
        cancelable: true
      }));
    });
    await window.waitForTimeout(1_000);
    const afterResize = await snapshot(frame);
    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    });
    const undoDeadline = Date.now() + 10_000;
    let afterResizeUndo = await snapshot(frame);
    while (
      Date.now() < undoDeadline
      && afterResizeUndo.settings.items[0].widthMm
        !== after.settings.items[0].widthMm
    ) {
      await window.waitForTimeout(100);
      afterResizeUndo = await snapshot(frame);
    }
    const summarize = (value) => ({
      count: value.marks.length,
      visible: value.marks.filter((item) =>
        item.display !== "none"
        && item.visibility !== "hidden"
        && Number(item.opacity) > 0
        && item.width > 0
        && item.height > 0
        && item.intersects
      ).length,
      first: value.marks[0],
      second: value.marks[1],
      offsets: {
        x: value.settings.items[0].offsetXmm,
        y: value.settings.items[0].offsetYmm
      }
    });
    console.log(JSON.stringify({
      before: summarize(before),
      after: summarize(after),
      afterResize: summarize(afterResize),
      afterResizeUndo: summarize(afterResizeUndo)
    }, null, 2));
    if (
      summarize(after).visible !== 38
      || summarize(afterResize).visible !== 38
      || afterResize.settings.items[0].widthMm
        === after.settings.items[0].widthMm
      || afterResizeUndo.settings.items[0].widthMm
        !== after.settings.items[0].widthMm
      || afterResize.marks.some((mark) =>
        Math.abs(mark.width - afterResize.marks[0].width) > 0.1
      )
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
