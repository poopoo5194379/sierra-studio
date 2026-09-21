import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  AssetImporter,
  materializeEditableSvgDiagrams,
  normalizeImportedDocumentShell
} from "./asset-importer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("AssetImporter", () => {
  it("materializes explicit SVG diagrams as editable text and boxes", () => {
    const { document } = parseHTML([
      '<html><body><div class="diagram-svg">',
      '<svg viewBox="0 0 200 100">',
      '<defs><linearGradient id="fade"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.1"/><stop offset="100%" stop-color="#000000"/></linearGradient></defs>',
      '<rect x="10" y="10" width="180" height="60" rx="8" fill="url(#fade)"/>',
      '<text x="100" y="45" text-anchor="middle" letter-spacing="2" fill="#123">AI 能力引擎</text>',
      '<line x1="20" y1="80" x2="180" y2="80" stroke="#456"/>',
      '</svg></div></body></html>'
    ].join(""));

    expect(materializeEditableSvgDiagrams(document)).toBe(1);
    expect(document.querySelector("svg")).toBeNull();
    const diagram = document.querySelector("[data-hs-svg-materialized]");
    expect(diagram?.textContent).toContain("AI 能力引擎");
    expect(diagram?.querySelectorAll("div").length).toBe(3);
    expect(diagram?.innerHTML).toContain("rgba(255, 255, 255, 0.1)");
    expect(diagram?.innerHTML).toContain("letter-spacing:2px");
  });

  it("leaves compact strip diagrams intact and removes an invalid auto height", () => {
    const { document } = parseHTML(
      '<html><body><div class="diagram-svg"><svg viewBox="0 0 840 110" height="auto"><path d="M0 0 Q 20 20 40 0"/></svg></div></body></html>'
    );

    expect(materializeEditableSvgDiagrams(document)).toBe(0);
    expect(document.querySelector("svg")).not.toBeNull();
    expect(document.querySelector("svg")?.hasAttribute("height")).toBe(false);
  });

  it("repairs a missing html/head opening shell without dropping the body", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "html-studio-source-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "html-studio-project-"));
    temporaryDirectories.push(sourceRoot, projectRoot);
    const sourcePath = join(sourceRoot, "broken-shell.html");
    const html = [
      "<title>品牌感受力</title>",
      "<style>body{color:#123456}</style>",
      "</head>",
      '<body><main id="content">完整正文</main></body>',
      "</html>"
    ].join("\n");

    const normalized = normalizeImportedDocumentShell(html);
    expect(normalized).toContain("<html><head>");
    expect(normalized).toContain('<body><main id="content">');

    const result = await new AssetImporter(projectRoot).importHtml(
      sourcePath,
      html
    );
    expect(result.html).toContain("<html><head>");
    expect(result.html).toContain("<title>品牌感受力</title>");
    expect(result.html).toContain('<main id="content">完整正文</main>');
    expect(result.html.length).toBeGreaterThan(100);
  });

  it("preserves known remote styles for the bundled runtime mapper", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "html-studio-source-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "html-studio-project-"));
    temporaryDirectories.push(sourceRoot, projectRoot);
    const sourcePath = join(sourceRoot, "index.html");
    const bootstrap =
      "https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css";
    const googleFonts =
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;700";
    const html = [
      "<html><head>",
      `<link rel="stylesheet" href="${bootstrap}">`,
      `<link rel="stylesheet" href="${googleFonts}">`,
      "</head><body>Ready</body></html>"
    ].join("");

    const result = await new AssetImporter(projectRoot).importHtml(
      sourcePath,
      html
    );

    expect(result.html).toContain(`href="${bootstrap}"`);
    expect(result.html).toContain(
      `data-hs-original-href="${bootstrap}"`
    );
    expect(result.html).toContain(`href="${googleFonts}"`);
    expect(result.assets).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  it("skips blocking remote font stylesheets during local import", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "html-studio-source-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "html-studio-project-"));
    temporaryDirectories.push(sourceRoot, projectRoot);
    const sourcePath = join(sourceRoot, "index.html");
    const cssPath = join(sourceRoot, "styles.css");
    const html = '<html><head><link rel="stylesheet" href="./styles.css"></head><body>Ready</body></html>';
    await writeFile(sourcePath, html);
    await writeFile(
      cssPath,
      "@import url('https://fonts.googleapis.com/css2?family=Oswald');body{font-family:Oswald,sans-serif}"
    );

    const startedAt = Date.now();
    const result = await new AssetImporter(projectRoot).importHtml(
      sourcePath,
      html
    );

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.warnings.join("\n")).toContain("已跳过远程字体下载");
    const cssRecord = result.assets.find((asset) => asset.mimeType === "text/css");
    const rewrittenCss = await readFile(
      join(projectRoot, cssRecord!.storedPath),
      "utf8"
    );
    expect(rewrittenCss).not.toContain("fonts.googleapis.com");
    expect(rewrittenCss).toContain("font-family:Oswald,sans-serif");
  });

  it("rewrites HTML and nested CSS URLs into content-addressed assets", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "html-studio-source-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "html-studio-project-"));
    temporaryDirectories.push(sourceRoot, projectRoot);
    await mkdir(join(sourceRoot, "styles"));
    await mkdir(join(sourceRoot, "images"));
    await writeFile(join(sourceRoot, "images", "hero.png"), Buffer.from([1, 2, 3]));
    await writeFile(
      join(sourceRoot, "styles", "site.css"),
      "body{background-image:url('../images/hero.png')}"
    );
    await writeFile(
      join(sourceRoot, "chart.js"),
      "window.renderImportedChart = true"
    );
    const sourcePath = join(sourceRoot, "index.html");
    const html = [
      '<html><head><base href="./">',
      '<link rel="stylesheet" href="./styles/site.css">',
      '<script src="./chart.js"></script>',
      "</head><body>",
      '<img src="./images/hero.png">',
      '<img srcset="./images/hero.png 1x, ./images/hero.png 2x">',
      '<div style="background-image:url(\'./images/hero.png\');color:#fff;border:none">Hero</div>',
      "</body></html>"
    ].join("");
    await writeFile(sourcePath, html);

    const result = await new AssetImporter(projectRoot).importHtml(sourcePath, html);
    expect(result.html).toMatch(/\.\.\/assets\/[a-f0-9]+\.css/);
    expect(result.html).toMatch(/\.\.\/assets\/[a-f0-9]+\.png/);
    expect(result.html).not.toContain("<base");
    expect(result.html).toMatch(
      /srcset="\.\.\/assets\/[a-f0-9]+\.png 1x, \.\.\/assets\/[a-f0-9]+\.png 2x"/
    );
    expect(result.html).toMatch(/\.\.\/assets\/[a-f0-9]+\.js/);
    expect(result.html).toMatch(
      /style="background-image:url\([^)]*assets\/[a-f0-9]+\.png[^)]*\);color:#fff;border:none"/
    );
    expect(result.assets).toHaveLength(3);
    expect(result.warnings).toEqual([]);

    const cssRecord = result.assets.find((asset) => asset.mimeType === "text/css");
    expect(cssRecord).toBeTruthy();
    const rewrittenCss = await readFile(
      join(projectRoot, cssRecord!.storedPath),
      "utf8"
    );
    expect(rewrittenCss).toMatch(/url\('\.\.\/assets\/[a-f0-9]+\.png'\)|url\(\.\.\/assets\/[a-f0-9]+\.png\)/);
  });

  it("blocks private-network remote assets without contacting them", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "html-studio-source-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "html-studio-project-"));
    temporaryDirectories.push(sourceRoot, projectRoot);
    const sourcePath = join(sourceRoot, "index.html");
    const html = [
      '<html><body><img src="https://127.0.0.1/private.png">',
      '<div id="poster"></div><script>',
      'poster.style.backgroundImage="url(https://127.0.0.1/poster.jpg)"',
      "</script></body></html>"
    ].join("");
    await writeFile(sourcePath, html);

    const result = await new AssetImporter(projectRoot).importHtml(
      sourcePath,
      html
    );
    expect(result.html).toContain("data:image/svg+xml");
    expect(result.html).toContain(
      'data-hs-remote-unavailable="https://127.0.0.1/private.png"'
    );
    expect(result.html).not.toContain(
      'backgroundImage="url(https://127.0.0.1/poster.jpg)"'
    );
    expect(result.assets).toHaveLength(0);
    expect(result.warnings.join("\n")).toContain("私网");
  });
});
