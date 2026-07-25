const path = require("node:path");
const { _electron: electron } = require("playwright");

(async () => {
  const projectRoot = path.join(__dirname, "..");
  let server = null;
  let rendererUrl = process.env.SIERRA_VITE_URL;
  if (!rendererUrl) {
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
  const executablePath = path.join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: [projectRoot],
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl }
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
    console.log(JSON.stringify({
      selected: true,
      runtimeReady: true,
      canvasViewport,
      errors
    }, null, 2));
  } finally {
    await application.close();
    if (server) await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
