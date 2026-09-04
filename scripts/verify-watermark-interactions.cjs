const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.join(__dirname, "..");
const sourceProjectDir = process.argv[2];
if (!sourceProjectDir || !fs.existsSync(
  path.join(sourceProjectDir, "project.json")
)) {
  throw new Error(
    "Usage: node scripts/verify-watermark-interactions.cjs <project-dir>"
  );
}

const project = JSON.parse(fs.readFileSync(
  path.join(sourceProjectDir, "project.json"),
  "utf8"
));
const userDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "sierra-watermark-interactions-")
);
fs.mkdirSync(path.join(userDataDir, "projects"), { recursive: true });
fs.cpSync(
  sourceProjectDir,
  path.join(userDataDir, "projects", project.projectId),
  { recursive: true }
);

const packagedExecutable = process.env.SIERRA_TEST_EXECUTABLE;
const executablePath = packagedExecutable || path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const checks = [];
function check(name, pass, details = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${details ? `: ${details}` : ""}`);
}

async function manifest(frame) {
  return frame.locator("body").evaluate(() => {
    const text = document.querySelector(
      "script[data-hs-watermark-manifest]"
    )?.textContent;
    return text ? JSON.parse(text) : null;
  });
}

async function waitForOffsets(frame, expected, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let current = await manifest(frame);
  while (
    Date.now() < deadline
    && (
      current?.items?.[0]?.offsetXmm !== expected.offsetXmm
      || current?.items?.[0]?.offsetYmm !== expected.offsetYmm
    )
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    current = await manifest(frame);
  }
  return current;
}

(async () => {
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
    window.setDefaultTimeout(30_000);
    await window.locator(".activity-rail").waitFor();
    await window.evaluate((projectId) => {
      localStorage.setItem("sierra-studio:last-project", projectId);
    }, project.projectId);
    await window.reload();
    await window.locator(".runtime-state.ready").waitFor({
      timeout: 120_000
    });
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await frame.locator(".company-watermark").first().waitFor({
      timeout: 120_000
    });

    await window.getByRole("button", { name: "全局水印" }).click();
    await window.getByTitle("重新检测现有水印").click();
    const detections = window.locator(".watermark-detection");
    await detections.first().waitFor();
    check(
      "detects the two overlapping legacy logo groups",
      await detections.count() === 2,
      `groups=${await detections.count()}`
    );

    const company = detections.filter({ hasText: ".company-watermark" });
    await company.getByRole("button", { name: "转换" }).click();
    await window.getByRole("button", { name: "应用并保存" }).click();
    await window.getByText("已保存 1 个全局水印").waitFor();
    await window.waitForTimeout(500);

    const beforeNudge = await manifest(frame);
    await window.getByRole("button", { name: "水印右移" }).click();
    await window.waitForTimeout(700);
    const afterNudge = await manifest(frame);
    const beforeItem = beforeNudge.items[0];
    const nudgedItem = afterNudge.items[0];
    check(
      "one-click nudge moves every page and commits immediately",
      Math.abs(nudgedItem.offsetXmm - beforeItem.offsetXmm) === 0.5
        && await frame.locator(
          `[data-hs-watermark-id="${nudgedItem.id}"]`
        ).count() === 38,
      `x=${beforeItem.offsetXmm}->${nudgedItem.offsetXmm}`
    );

    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    });
    const afterKeyboardUndo = await waitForOffsets(frame, beforeItem);
    check(
      "Ctrl+Z from inside the canvas reaches project history",
      afterKeyboardUndo.items[0].offsetXmm === beforeItem.offsetXmm,
      `x=${afterKeyboardUndo.items[0].offsetXmm}`
    );

    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    });
    const beforeDrag = await waitForOffsets(frame, nudgedItem);
    const id = beforeDrag.items[0].id;
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
          clientX: 120,
          clientY: 112,
          bubbles: true,
          cancelable: true
        }));
        window.dispatchEvent(new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          clientX: 120,
          clientY: 112,
          bubbles: true,
          cancelable: true
        }));
      });
    await window.waitForTimeout(300);
    const afterDrag = await manifest(frame);
    check(
      "dragging one instance moves the global watermark on all pages",
      afterDrag.items[0].offsetXmm !== beforeDrag.items[0].offsetXmm
        && afterDrag.items[0].offsetYmm !== beforeDrag.items[0].offsetYmm
        && await frame.locator(
          `[data-hs-watermark-id="${id}"]`
        ).count() === 38,
      `x=${beforeDrag.items[0].offsetXmm}->${afterDrag.items[0].offsetXmm}, `
        + `y=${beforeDrag.items[0].offsetYmm}->${afterDrag.items[0].offsetYmm}`
    );

    await frame.locator("body").evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
    });
    const afterDragUndo = await waitForOffsets(frame, beforeDrag.items[0]);
    check(
      "Ctrl+Z reverses a global canvas drag",
      afterDragUndo.items[0].offsetXmm === beforeDrag.items[0].offsetXmm
        && afterDragUndo.items[0].offsetYmm === beforeDrag.items[0].offsetYmm,
      `x=${afterDrag.items[0].offsetXmm}->${afterDragUndo.items[0].offsetXmm}, `
        + `y=${afterDrag.items[0].offsetYmm}->${afterDragUndo.items[0].offsetYmm}`
    );
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  if (checks.some((item) => !item.pass)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
