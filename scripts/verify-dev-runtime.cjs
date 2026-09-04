const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { _electron: electron } = require("playwright");

(async () => {
  const projectRoot = path.join(__dirname, "..");
  const packagedExecutable = process.env.SIERRASTUDIO_E2E_EXECUTABLE;
  let server = null;
  let rendererUrl = process.env.SIERRA_VITE_URL;
  if (!packagedExecutable && !rendererUrl) {
    const { createServer } = await import("vite");
    server = await createServer({
      root: path.join(projectRoot, "src", "renderer"),
      server: {
        host: "127.0.0.1",
        port: 0,
        cors: true,
        fs: { allow: [projectRoot] }
      }
    });
    await server.listen();
    const address = server.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    rendererUrl = `http://127.0.0.1:${port}/`;
  }
  const executablePath = packagedExecutable
    ? path.resolve(packagedExecutable)
    : path.join(
      projectRoot,
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron"
    );
  const userDataDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sierra-e2e-dev-")
  );
  const application = await electron.launch({
    executablePath,
    args: packagedExecutable
      ? ["--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"]
      : [
        projectRoot,
        "--no-sandbox",
        "--disable-gpu",
        "--disable-gpu-compositing"
      ],
    env: {
      ...process.env,
      ...(rendererUrl ? { ELECTRON_RENDERER_URL: rendererUrl } : {}),
      SIERRASTUDIO_USER_DATA_DIR: userDataDirectory
    }
  });
  const errors = [];
  try {
    const window = await application.firstWindow();
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const htmlPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.join(projectRoot, "examples", "demo.html");
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, htmlPath);
    await window.locator(".empty-state").click();
    const frame = window.frameLocator('iframe[title="HTML editing canvas"]');
    await window.locator(".runtime-state.ready").waitFor({ timeout: 15_000 });
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.count()) {
      await compatibilityDialog.locator("button.primary").click();
    }

    const heading = frame.locator("h1").first();
    await heading.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    });
    const inner = await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
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
    const target = {
      x: iframe.x + inner.x * (iframe.width / iframe.viewportWidth) + 5,
      y: iframe.y + inner.y * (iframe.height / iframe.viewportHeight) + 5
    };
    await window.mouse.move(target.x, target.y);
    await window.mouse.down();
    await window.mouse.move(target.x + 2, target.y + 1);
    await window.mouse.up();
    await window.locator(".selection-title").waitFor();

    const canvasViewport = await frame.locator("html").evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }));
    const compatibility = await frame.locator("html").evaluate(() => {
      const grid = document.querySelector(".grid");
      const flex = document.querySelector(".flex");
      const fullHeight = document.querySelector(".min-h-screen");
      const generatedRoots = [
        "colorGrids",
        "market",
        "seasons",
        "seasonTable",
        "beautyBody"
      ]
        .map((id) => document.getElementById(id))
        .filter(Boolean);
      const generatedElements = generatedRoots.flatMap(
        (root) => [...root.querySelectorAll("*")]
      );
      return {
        tailwindRuntime: Boolean(
          document.querySelector(
            '[data-hs-runtime-dependency="tailwind-browser"]'
          )
        ),
        gridDisplay: grid ? getComputedStyle(grid).display : null,
        flexDisplay: flex ? getComputedStyle(flex).display : null,
        minScreenHeight: fullHeight
          ? getComputedStyle(fullHeight).minHeight
          : null,
        generatedElements: generatedElements.length,
        editableGeneratedElements: generatedElements.filter(
          (element) => element.getAttribute("data-hs-id")?.startsWith("dyn_")
        ).length
      };
    });
    if (
      compatibility.tailwindRuntime
      && compatibility.gridDisplay !== null
      && compatibility.gridDisplay !== "grid"
    ) {
      throw new Error(
        `Tailwind grid compatibility failed: ${compatibility.gridDisplay}`
      );
    }
    if (
      compatibility.generatedElements > 0
      && compatibility.editableGeneratedElements === 0
    ) {
      throw new Error("Generated content did not receive dynamic editor IDs");
    }
    if (compatibility.editableGeneratedElements > 0) {
      const dynamicTextEditing = await frame.locator("html").evaluate(() => {
        const roots = [
          "colorGrids",
          "market",
          "seasons",
          "seasonTable",
          "beautyBody"
        ]
          .map((id) => document.getElementById(id))
          .filter(Boolean);
        const candidate = roots
          .flatMap((root) => [...root.querySelectorAll("[data-hs-id^='dyn_']")])
          .find((element) =>
            element instanceof HTMLElement
            && element.tagName !== "IMG"
            && element.childElementCount === 0
            && Boolean(element.textContent?.trim())
          );
        if (!(candidate instanceof HTMLElement)) return false;
        candidate.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window
        }));
        const editable = candidate.isContentEditable;
        candidate.blur();
        return editable;
      });
      if (!dynamicTextEditing) {
        throw new Error("Generated text could not enter live editing mode");
      }
      compatibility.dynamicTextEditing = dynamicTextEditing;
    }
    const hasRerenderFixture = await frame.locator("html").evaluate(
      () => typeof window.__sierraTestRerender === "function"
    );
    if (hasRerenderFixture) {
      const stablePatch = await frame.locator("html").evaluate(async () => {
        const alpha = document.querySelector("[data-key='alpha'] h2");
        if (!(alpha instanceof HTMLElement)) return false;
        alpha.dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window
        }));
        alpha.textContent = "Alpha edited";
        alpha.blur();
        await new Promise((resolve) => setTimeout(resolve, 300));
        window.__sierraTestRerender();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return document.querySelector("[data-key='alpha'] h2")?.textContent
          === "Alpha edited";
      });
      if (!stablePatch) {
        throw new Error("Dynamic patch did not survive keyed re-render");
      }
      compatibility.stablePatchAfterRerender = true;

      await window.locator('iframe[title="HTML editing canvas"]').evaluate(
        (iframe) => iframe.contentWindow.postMessage({
          source: "html-studio-host",
          action: "materialize-document"
        }, "*")
      );
      await window.waitForTimeout(5_500);
      await window.locator(".runtime-state.ready").waitFor({ timeout: 15_000 });
      const materialized = await frame.locator("html").evaluate(() => ({
        scripts: document.querySelectorAll("script[data-hs-user-script]").length,
        dynamicIds: document.querySelectorAll("[data-hs-id^='dyn_']").length,
        persistentIds: document.querySelectorAll("[data-hs-id^='node_']").length,
        gridDisplay: getComputedStyle(
          document.querySelector("#report-root")
        ).display
      }));
      if (
        materialized.scripts !== 0
        || materialized.dynamicIds !== 0
        || materialized.persistentIds === 0
        || materialized.gridDisplay !== "grid"
      ) {
        throw new Error(
          `Materialized project validation failed: ${JSON.stringify(materialized)}`
        );
      }
      compatibility.materializedStaticCopy = true;
    }
    console.log(JSON.stringify({
      selected: true,
      runtimeReady: true,
      canvasViewport,
      compatibility,
      errors
    }, null, 2));
  } finally {
    await application.close();
    if (server) await server.close();
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
