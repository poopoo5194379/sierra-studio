const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const projectRoot = path.join(__dirname, "..");
const fixturePath = path.join(__dirname, "fixtures", "test-page.html");
const executablePath = path.join(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sierra-layout-"));

(async () => {
  const errors = [];
  const result = {};
  const application = await electron.launch({
    executablePath,
    args: [projectRoot, `--user-data-dir=${userDataDir}`]
  });

  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await window.locator(".runtime-state.ready").waitFor({ timeout: 30_000 });
    result.welcome = {
      title: await window.locator(".brand-copy small").innerText(),
      saveIndicatorCount: await window.locator(".save-indicator").count()
    };
    const welcomeFrame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const firstCardTitle = welcomeFrame.locator(
      '[data-hs-id="welcome-card-title-1"]'
    );
    const secondCardTitle = welcomeFrame.locator(
      '[data-hs-id="welcome-card-title-2"]'
    );
    const firstWelcomeCard = welcomeFrame.locator(
      '[data-hs-id="welcome-card-edit"]'
    );
    const secondWelcomeCard = welcomeFrame.locator(
      '[data-hs-id="welcome-card-style"]'
    );
    const thirdWelcomeCard = welcomeFrame.locator(
      '[data-hs-id="welcome-card-move"]'
    );
    const thirdCardLeftBefore = await thirdWelcomeCard.evaluate(
      (element) => element.getBoundingClientRect().left
    );
    await firstCardTitle.dispatchEvent("click");
    await secondCardTitle.dispatchEvent("click", { shiftKey: true });
    await window.locator(".align-grid button").nth(2).click();
    result.pptObjectAlignment = await firstWelcomeCard.evaluate(
      (element, input) => {
        const second = document.querySelector(input.secondSelector);
        const third = document.querySelector(input.thirdSelector);
        return {
          rightDelta: Math.abs(
            element.getBoundingClientRect().right
            - second.getBoundingClientRect().right
          ),
          thirdCardUnchanged:
            Math.abs(third.getBoundingClientRect().left - input.thirdLeft) < 1,
          promotedToCard:
            element.style.getPropertyValue("--hs-free-origin") !== ""
            && second.style.getPropertyValue("--hs-free-origin") !== ""
        };
      },
      {
        secondSelector: '[data-hs-id="welcome-card-style"]',
        thirdSelector: '[data-hs-id="welcome-card-move"]',
        thirdLeft: thirdCardLeftBefore
      }
    );
    await window.locator(".switch-field").click();

    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, fixturePath);

    await window.locator(".toolbar .toolbar-button").first().click();
    const importedFrame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await importedFrame.locator('[data-hs-id="col-1"]').waitFor({ timeout: 30_000 });
    const modal = window.locator(".modal-backdrop");
    if (await modal.isVisible()) {
      const continueButton = modal.locator("button.primary");
      if (await continueButton.isVisible()) await continueButton.click();
    }
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    const col1 = frame.locator('[data-hs-id="col-1"]');
    const col2 = frame.locator('[data-hs-id="col-2"]');
    const row = frame.locator('[data-hs-id="row-1"]');
    const layoutBefore = await row.evaluate((element, followingSelector) => ({
      rowHeight: element.getBoundingClientRect().height,
      followingTop: document.querySelector(followingSelector).getBoundingClientRect().top
    }), '[data-hs-id="runtime-list"]');
    const clickCanvasElement = async (locator, modifiers = []) => {
      await locator.dispatchEvent("click", {
        shiftKey: modifiers.includes("Shift"),
        ctrlKey: modifiers.includes("Control"),
        metaKey: modifiers.includes("Meta")
      });
      await window.waitForTimeout(150);
    };

    await clickCanvasElement(col1);
    await clickCanvasElement(col2, ["Shift"]);
    if (!(await window.locator(".align-grid").isVisible())) {
      throw new Error(
        JSON.stringify(
          {
            panel: await window.locator(".right-panel").innerText(),
            col1: await col1.evaluate((element) => element.getBoundingClientRect().toJSON()),
            col2: await col2.evaluate((element) => element.getBoundingClientRect().toJSON())
          },
          null,
          2
        )
      );
    }
    await window.locator(".align-grid button").nth(0).click();
    await window.waitForTimeout(250);

    result.aligned = await col1.evaluate((first, secondSelector) => {
      const second = document.querySelector(secondSelector);
      return {
        xDelta: Math.round(
          Math.abs(first.getBoundingClientRect().left - second.getBoundingClientRect().left)
        ),
        bothFree:
          first.style.getPropertyValue("--hs-free-origin").length > 0 &&
          second.style.getPropertyValue("--hs-free-origin").length > 0
      };
    }, '[data-hs-id="col-2"]');
    result.layoutAfterAlign = await row.evaluate((element, followingSelector) => ({
      rowHeight: element.getBoundingClientRect().height,
      followingTop: document.querySelector(followingSelector).getBoundingClientRect().top
    }), '[data-hs-id="runtime-list"]');

    await window.locator(".switch-field").click();
    await window.waitForTimeout(250);
    result.restored = await col1.evaluate((first, secondSelector) => {
      const second = document.querySelector(secondSelector);
      return {
        xGap: Math.round(
          Math.abs(first.getBoundingClientRect().left - second.getBoundingClientRect().left)
        ),
        positions: [getComputedStyle(first).position, getComputedStyle(second).position],
        noMarkers:
          !first.style.getPropertyValue("--hs-free-origin") &&
          !second.style.getPropertyValue("--hs-free-origin")
      };
    }, '[data-hs-id="col-2"]');

    const runAlignmentCheck = async (
      first,
      second,
      secondSelector,
      buttonIndex,
      axis
    ) => {
      await clickCanvasElement(first);
      await clickCanvasElement(second, ["Shift"]);
      await window.locator(".align-grid button").nth(buttonIndex).click();
      await window.waitForTimeout(100);
      const delta = await first.evaluate((element, input) => {
        const other = document.querySelector(input.selector);
        const a = element.getBoundingClientRect();
        const b = other.getBoundingClientRect();
        const value = (rect) => {
          if (input.axis === "center") return rect.left + rect.width / 2;
          if (input.axis === "right") return rect.right;
          if (input.axis === "top") return rect.top;
          if (input.axis === "middle") return rect.top + rect.height / 2;
          return rect.bottom;
        };
        return Math.abs(value(a) - value(b));
      }, { selector: secondSelector, axis });
      await window.locator(".switch-field").click();
      await window.waitForTimeout(100);
      return Math.round(delta * 10) / 10;
    };

    const heading = frame.locator('[data-hs-id="h1-1"]');
    const paragraph = frame.locator('[data-hs-id="p-1"]');
    result.remainingAlignments = {
      center: await runAlignmentCheck(
        col1, col2, '[data-hs-id="col-2"]', 1, "center"
      ),
      right: await runAlignmentCheck(
        col1, col2, '[data-hs-id="col-2"]', 2, "right"
      ),
      top: await runAlignmentCheck(
        heading, paragraph, '[data-hs-id="p-1"]', 3, "top"
      ),
      middle: await runAlignmentCheck(
        heading, paragraph, '[data-hs-id="p-1"]', 4, "middle"
      ),
      bottom: await runAlignmentCheck(
        heading, paragraph, '[data-hs-id="p-1"]', 5, "bottom"
      )
    };

    const nestedHeading = frame.locator('[data-hs-id="card-h2"]');
    await clickCanvasElement(nestedHeading);
    await clickCanvasElement(paragraph, ["Shift"]);
    const crossContainerBefore = await nestedHeading.evaluate(
      (element) => element.getBoundingClientRect().left
    );
    await window.locator(".align-grid button").nth(2).click();
    result.crossContainerRejected = await nestedHeading.evaluate(
      (element, beforeLeft) => ({
        unchanged: Math.abs(element.getBoundingClientRect().left - beforeLeft) < 1,
        noFreeMarker: !element.style.getPropertyValue("--hs-free-origin")
      }),
      crossContainerBefore
    );

    const card = frame.locator('[data-hs-id="card-1"]');
    await clickCanvasElement(card);
    if (!(await window.locator(".switch-field input").isChecked())) {
      await window.locator(".switch-field").click();
    }
    await window.locator(".inspector-tabs button").nth(1).click();
    const before = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, zIndex: Number(getComputedStyle(element).zIndex) || 0 };
    });

    await window.locator(".position-nudge-grid button").nth(0).click();
    const afterUp = await card.evaluate((element) => element.getBoundingClientRect().top);
    await window.locator(".position-nudge-grid button").nth(1).click();
    const afterDown = await card.evaluate((element) => element.getBoundingClientRect().top);
    await window.locator(".z-index-controls button").nth(0).click();
    const afterFront = await card.evaluate(
      (element) => Number(getComputedStyle(element).zIndex) || 0
    );

    result.controls = {
      upDelta: Math.round(afterUp - before.top),
      roundTripDelta: Math.round(afterDown - before.top),
      frontDelta: afterFront - before.zIndex
    };

    if (
      result.aligned.xDelta > 1 ||
      !result.aligned.bothFree ||
      Math.abs(result.layoutAfterAlign.rowHeight - layoutBefore.rowHeight) > 1 ||
      Math.abs(result.layoutAfterAlign.followingTop - layoutBefore.followingTop) > 1 ||
      result.restored.xGap < 20 ||
      result.restored.positions.some((position) => position !== "static") ||
      !result.restored.noMarkers ||
      Object.values(result.remainingAlignments).some((delta) => delta > 1) ||
      !result.crossContainerRejected.unchanged ||
      !result.crossContainerRejected.noFreeMarker ||
      result.controls.upDelta !== -10 ||
      result.controls.roundTripDelta !== 0 ||
      result.controls.frontDelta !== 10 ||
      result.welcome.title !== "SierraStudio 入门样例" ||
      result.welcome.saveIndicatorCount !== 0 ||
      result.pptObjectAlignment.rightDelta > 1 ||
      !result.pptObjectAlignment.thirdCardUnchanged ||
      !result.pptObjectAlignment.promotedToCard ||
      errors.length
    ) {
      throw new Error(JSON.stringify({ result, errors }, null, 2));
    }

    process.stdout.write(`${JSON.stringify({ result, errors }, null, 2)}\n`);
  } finally {
    await application.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
