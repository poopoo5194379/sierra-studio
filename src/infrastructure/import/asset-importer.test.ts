import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AssetImporter } from "./asset-importer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("AssetImporter", () => {
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
