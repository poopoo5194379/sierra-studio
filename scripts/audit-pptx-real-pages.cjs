const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const JSZip = require("jszip");

function slideFileNames(zip) {
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) =>
      Number(left.match(/slide(\d+)/)?.[1] || 0)
      - Number(right.match(/slide(\d+)/)?.[1] || 0)
    );
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function inspectTransforms(xml, slideWidth, slideHeight) {
  const objects = [];
  for (const tag of ["sp", "pic", "graphicFrame"]) {
    const pattern = new RegExp(`<p:${tag}\\b[\\s\\S]*?<\\/p:${tag}>`, "g");
    for (const match of xml.matchAll(pattern)) {
      const node = match[0];
      const xfrm = node.match(/<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/)?.[0];
      const offset = xfrm?.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
      const extent = xfrm?.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
      if (!offset || !extent) continue;
      const x = Number(offset[1]);
      const y = Number(offset[2]);
      const width = Number(extent[1]);
      const height = Number(extent[2]);
      objects.push({
        tag,
        x: x / slideWidth,
        y: y / slideHeight,
        right: (x + width) / slideWidth,
        bottom: (y + height) / slideHeight
      });
    }
  }
  return objects;
}

async function inspectPptx(filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const presentationXml = await zip.file("ppt/presentation.xml").async("string");
  const slideSize = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!slideSize) throw new Error("PPTX 缺少页面尺寸");
  const slideWidth = Number(slideSize[1]);
  const slideHeight = Number(slideSize[2]);
  const slideFiles = slideFileNames(zip);
  const slides = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile).async("string");
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
    const transforms = inspectTransforms(xml, slideWidth, slideHeight);
    slides.push({
      objects: [...xml.matchAll(/<p:cNvPr\b/g)].length - 1,
      textChars: text.length,
      pictures: [...xml.matchAll(/<p:pic>/g)].length,
      severeOutside: transforms.filter((item) =>
        item.x < -0.2 || item.y < -0.2 || item.right > 1.2 || item.bottom > 1.2
      ).length
    });
  }
  const invalidGradientSvgs = [];
  for (const name of Object.keys(zip.files).filter((entry) => /\.svg$/i.test(entry))) {
    const svg = await zip.file(name).async("string");
    if (/stop-color=["'](?:linear|radial|repeating)-gradient\(/i.test(svg)) {
      invalidGradientSvgs.push(name);
    }
  }
  const embeddedFontParts = Object.keys(zip.files).filter((name) =>
    /^ppt\/fonts\/[^/]+$/i.test(name) && !zip.files[name].dir
  );
  return {
    bytes: fs.statSync(filePath).size,
    slides: slides.length,
    slideAspectRatio: slideWidth / slideHeight,
    emptySlides: slides.filter((slide) => slide.objects <= 0).length,
    textlessSlides: slides.filter((slide) => slide.textChars <= 0).length,
    totalObjects: slides.reduce((sum, slide) => sum + slide.objects, 0),
    totalTextChars: slides.reduce((sum, slide) => sum + slide.textChars, 0),
    totalPictures: slides.reduce((sum, slide) => sum + slide.pictures, 0),
    severeOutsideObjects: slides.reduce(
      (sum, slide) => sum + slide.severeOutside,
      0
    ),
    embeddedFontParts: embeddedFontParts.length,
    hasEmbeddedFontList: /<p:embeddedFontLst>/i.test(presentationXml),
    invalidGradientSvgs
  };
}

async function exportEditablePptx(projectRoot, htmlPath, outputPath) {
  const userData = path.join(projectRoot, "tmp", "pptx-real-audit-user-data");
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const packagedExecutable = process.env.SIERRA_REAL_AUDIT_EXECUTABLE;
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
      SIERRASTUDIO_USER_DATA_DIR: userData
    }
  });
  const rendererErrors = [];
  let status = "";
  try {
    await application.firstWindow();
    let window;
    const mainDeadline = Date.now() + 30_000;
    while (Date.now() < mainDeadline) {
      for (const candidate of application.windows()) {
        if (!candidate.isClosed() && await candidate.locator(".toolbar").count()) {
          window = candidate;
          break;
        }
      }
      if (window) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window || window.isClosed()) {
      throw new Error("SierraStudio main editor window did not open");
    }
    window.on("pageerror", (error) => rendererErrors.push(error.message));
    window.on("console", (message) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    await application.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.html]
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: paths.output
      });
    }, {
      html: path.resolve(htmlPath),
      output: path.resolve(outputPath)
    });

    await window.locator(".toolbar .toolbar-button").first().click();
    await window.locator(".runtime-state.ready").waitFor({ timeout: 180_000 });
    const compatibilityDialog = window.locator(".compatibility-dialog");
    if (await compatibilityDialog.isVisible().catch(() => false)) {
      const closeButton = compatibilityDialog.locator(".icon-button");
      if (await closeButton.count()) await closeButton.click();
      else await compatibilityDialog.locator("button").last().click();
    }

    await window.getByRole("button", { name: "导出 PPTX" }).click();
    await window.getByRole("button", { name: /智能混合/ }).click();
    await window.getByRole("button", { name: "选择位置并导出" }).click();
    const successDialog = window.getByRole("dialog", { name: "导出成功" });
    await successDialog.waitFor({ timeout: 900_000 });
    status = (await window.locator(".statusbar").innerText()).split("\n")[0];
    await successDialog.getByRole("button", { name: "完成" }).click();
  } finally {
    await application.close();
  }
  if (!fs.existsSync(outputPath)) throw new Error("导出流程未生成 PPTX 文件");
  return { status, rendererErrors };
}

(async () => {
  const htmlPath = path.resolve(process.argv[2] || "");
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new Error("请传入存在的 HTML 文件路径");
  }
  const projectRoot = path.join(__dirname, "..");
  const outputPath = path.resolve(
    process.argv[3]
    || path.join(
      path.dirname(htmlPath),
      `${path.basename(htmlPath, path.extname(htmlPath))}-智能混合-修复版.pptx`
    )
  );
  const runtime = await exportEditablePptx(projectRoot, htmlPath, outputPath);
  const inspection = await inspectPptx(outputPath);
  const failures = [];
  if (inspection.slides !== 64) failures.push(`页数为 ${inspection.slides}，预期 64`);
  if (Math.abs(inspection.slideAspectRatio - 16 / 9) > 0.001) {
    failures.push("页面比例不是 16:9");
  }
  if (inspection.emptySlides > 0) failures.push(`${inspection.emptySlides} 页为空页`);
  if (inspection.textlessSlides > 0) failures.push(`${inspection.textlessSlides} 页没有文本`);
  if (inspection.severeOutsideObjects > 0) {
    failures.push(`${inspection.severeOutsideObjects} 个对象严重越界`);
  }
  if (inspection.embeddedFontParts < 4 || !inspection.hasEmbeddedFontList) {
    failures.push("Barlow Condensed / IBM Plex Mono 未完整嵌入 PPTX");
  }
  if (inspection.invalidGradientSvgs.length > 0) {
    failures.push("仍存在非法渐变 SVG");
  }
  const report = { outputPath, ...runtime, inspection, failures };
  const reportPath = path.join(projectRoot, "tmp", "pptx-real-audit.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
  if (failures.length > 0 || runtime.rendererErrors.length > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
