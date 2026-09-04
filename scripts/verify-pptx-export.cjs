const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const JSZip = require("jszip");

function slideFiles(zip) {
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();
}

(async () => {
  const projectRoot = path.join(__dirname, "..");
  const htmlPath = process.argv[2]
    || path.join(projectRoot, "scripts", "fixtures", "pptx-export.html");
  const expectsFixtureSlides = !process.argv[2];
  const outputDirectory = path.join(projectRoot, "tmp", "pptx");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const userDataDirectory = path.join(outputDirectory, "test-user-data");
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
  const hybridPath = path.join(outputDirectory, "sierra-hybrid.pptx");
  const editablePath = path.join(outputDirectory, "sierra-editable.pptx");
  const fidelityPath = path.join(outputDirectory, "sierra-fidelity.pptx");
  const requestedModes = (process.env.SIERRA_PPTX_MODES
    || (expectsFixtureSlides ? "hybrid,editable,fidelity" : "hybrid"))
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean);
  fs.rmSync(hybridPath, { force: true });
  fs.rmSync(editablePath, { force: true });
  fs.rmSync(fidelityPath, { force: true });
  const packagedExecutable = process.env.SIERRA_PPTX_EXECUTABLE;
  const executablePath = packagedExecutable || path.join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const application = await electron.launch({
    executablePath,
    args: packagedExecutable ? [] : [projectRoot],
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: userDataDirectory
    }
  });
  const errors = [];
  const exportStatuses = [];
  try {
    await application.firstWindow();
    let window;
    const mainDeadline = Date.now() + 30_000;
    while (Date.now() < mainDeadline) {
      for (const candidate of application.windows()) {
        try {
          if (!candidate.isClosed() && await candidate.locator(".toolbar").count()) {
            window = candidate;
            break;
          }
        } catch {
          // The frameless startup window is intentionally destroyed as soon
          // as the editor is ready; ignore that normal hand-off race.
        }
      }
      if (window) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window || window.isClosed()) {
      throw new Error("SierraStudio main editor window did not open");
    }
    window.on("pageerror", (error) => errors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.html]
      });
      dialog.showSaveDialog = async (...args) => {
        const options = args.at(-1);
        return ({
        canceled: false,
        filePath: String(options.defaultPath).includes("智能混合")
          ? paths.hybrid
          : String(options.defaultPath).includes("完全可编辑")
            ? paths.editable
            : paths.fidelity
        });
      };
    }, {
      html: path.resolve(htmlPath),
      hybrid: hybridPath,
      editable: editablePath,
      fidelity: fidelityPath
    });

    await window.locator(".toolbar .toolbar-button").first().click();
    const expectedTitle = fs.readFileSync(htmlPath, "utf8")
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
    if (expectedTitle) {
      const deadline = Date.now() + 120_000;
      let activeTitle = "";
      while (Date.now() < deadline) {
        const editorFrame = window.frames().find(
          (frame) => frame !== window.mainFrame()
            && frame.url().startsWith("htmlstudio-project://")
        );
        activeTitle = editorFrame
          ? await editorFrame.title().catch(() => "")
          : "";
        if (activeTitle === expectedTitle) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (activeTitle !== expectedTitle) {
        throw new Error(
          `Expected imported title "${expectedTitle}", got "${activeTitle}"`
        );
      }
    }
    await window.locator(".runtime-state.ready").waitFor({ timeout: 120_000 });
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.isVisible().catch(() => false)) {
      await compatibilityDialog.locator(".dialog-actions .primary").click();
    }

    const exportMode = async (mode) => {
      await window.getByRole("button", { name: "导出 PPTX" }).click();
      await window.getByRole("button", {
        name: mode === "hybrid"
          ? /智能混合/
          : mode === "editable"
            ? /完全可编辑/
            : /高清还原/
      }).click();
      await window.getByRole("button", { name: "选择位置并导出" }).click();
      await window.locator(".operation-progress").waitFor({ timeout: 10_000 });
      const successDialog = window.locator(".export-success-dialog");
      const deadline = Date.now() + 360_000;
      while (Date.now() < deadline) {
        if (await successDialog.isVisible().catch(() => false)) break;
        const currentStatus = await window.locator(".statusbar").innerText();
        if (currentStatus.includes("PowerPoint 导出失败")) {
          throw new Error(currentStatus);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!await successDialog.isVisible().catch(() => false)) {
        throw new Error(`Timed out waiting for ${mode} PowerPoint export`);
      }
      const status = await window.locator(".statusbar").innerText();
      exportStatuses.push({ mode, status });
      if (status.includes("失败")) throw new Error(status);
      await successDialog.getByRole("button", { name: "完成" }).click();
    };

    for (const mode of requestedModes) await exportMode(mode);

    const hybrid = requestedModes.includes("hybrid")
      ? await JSZip.loadAsync(fs.readFileSync(hybridPath))
      : null;
    const editable = requestedModes.includes("editable")
      ? await JSZip.loadAsync(fs.readFileSync(editablePath))
      : null;
    const fidelity = requestedModes.includes("fidelity")
      ? await JSZip.loadAsync(fs.readFileSync(fidelityPath))
      : null;
    const hybridSlides = hybrid ? slideFiles(hybrid) : [];
    const editableSlides = editable ? slideFiles(editable) : [];
    const fidelitySlides = fidelity ? slideFiles(fidelity) : [];
    const hybridXml = hybrid
      ? await hybrid.file(hybridSlides[0]).async("string")
      : "";
    const editableXml = editable
      ? await editable.file(editableSlides[0]).async("string")
      : "";
    const fidelityXml = fidelity
      ? await fidelity.file(fidelitySlides[0]).async("string")
      : "";

    if (expectsFixtureSlides && hybridSlides.length !== 2) {
      throw new Error(`Expected 2 hybrid slides, received ${hybridSlides.length}`);
    }
    if (expectsFixtureSlides && editableSlides.length !== 2) {
      throw new Error(`Expected 2 editable slides, received ${editableSlides.length}`);
    }
    if (expectsFixtureSlides && fidelitySlides.length !== 2) {
      throw new Error(`Expected 2 fidelity slides, received ${fidelitySlides.length}`);
    }
    if (editable && !editableXml.includes("文本 01")) {
      throw new Error("Editable export did not normalize layer names");
    }
    if (hybrid && !hybridXml.includes('typeface="Microsoft YaHei"')) {
      throw new Error("Hybrid export did not declare an East Asian font");
    }
    if (fidelity && !fidelityXml.includes("<p:pic>")) {
      throw new Error("Fidelity export did not contain a slide image");
    }
    if (expectsFixtureSlides && editable) {
      const editableRelationships = await editable.file(
        "ppt/slides/_rels/slide2.xml.rels"
      ).async("string");
      if (!editableRelationships.includes("relationships/chart")) {
        throw new Error("Editable export did not contain a native chart relationship");
      }
      if (!editable.file("ppt/charts/chart1.xml")) {
        throw new Error("Editable export did not contain native chart XML");
      }
      if (!editable.file("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")) {
        throw new Error("Editable export did not contain the chart workbook");
      }
    }

    console.log(JSON.stringify({
      hybridPath: hybrid ? hybridPath : null,
      editablePath,
      fidelityPath,
      hybridSlides: hybridSlides.length,
      editableSlides: editableSlides.length,
      fidelitySlides: fidelitySlides.length,
      hybridBytes: hybrid ? fs.statSync(hybridPath).size : 0,
      editableBytes: editable ? fs.statSync(editablePath).size : 0,
      fidelityBytes: fidelity ? fs.statSync(fidelityPath).size : 0,
      exportStatuses,
      errors
    }, null, 2));
    if (errors.length > 0) process.exitCode = 1;
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
