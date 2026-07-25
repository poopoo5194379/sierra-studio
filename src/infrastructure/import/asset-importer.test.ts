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
      "<html><head>",
      '<link rel="stylesheet" href="./styles/site.css">',
      '<script src="./chart.js"></script>',
      "</head><body>",
      '<img src="./images/hero.png">',
      '<div style="background-image:url(\'./images/hero.png\');color:#fff;border:none">Hero</div>',
      "</body></html>"
    ].join("");
    await writeFile(sourcePath, html);

    const result = await new AssetImporter(projectRoot).importHtml(sourcePath, html);
    expect(result.html).toMatch(/\.\.\/assets\/[a-f0-9]+\.css/);
    expect(result.html).toMatch(/\.\.\/assets\/[a-f0-9]+\.png/);
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
});
