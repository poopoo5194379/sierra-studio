import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import postcss, {
  type AtRule,
  type Container,
  type Declaration
} from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import { parseHTML } from "linkedom";
import type { AssetRecord } from "../sqlite/project-database";
import { atomicWriteFile } from "../filesystem/atomic-files";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const URL_ATTRIBUTES = [
  ["img", "src"],
  ["source", "src"],
  ["video", "poster"],
  ["link[rel='stylesheet']", "href"],
  ["script", "src"],
  ["object", "data"],
  ["image", "href"],
  ["use", "href"]
] as const;

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isLocalReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized)
    && !normalized.startsWith("#")
    && !normalized.startsWith("data:")
    && !normalized.startsWith("blob:")
    && !normalized.startsWith("http:")
    && !normalized.startsWith("https:")
    && !normalized.startsWith("//");
}

function withoutQueryOrHash(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

function serializeDocument(document: Document): string {
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export interface ImportResult {
  html: string;
  assets: AssetRecord[];
  warnings: string[];
}

export class AssetImporter {
  private readonly importedBySource = new Map<string, string>();
  private readonly records: AssetRecord[] = [];
  private readonly warnings: string[] = [];

  constructor(private readonly projectRoot: string) {}

  async importHtml(sourcePath: string, sourceHtml: string): Promise<ImportResult> {
    const { document } = parseHTML(sourceHtml);
    const htmlDirectory = dirname(sourcePath);

    for (const [selector, attribute] of URL_ATTRIBUTES) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const current = element.getAttribute(attribute);
        if (!current) continue;
        try {
          const localized = await this.localizeReference(current, htmlDirectory);
          if (localized) element.setAttribute(attribute, localized);
        } catch (error) {
          this.warnings.push(
            `无法本地化资源 ${current}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    for (const style of document.querySelectorAll("style")) {
      try {
        style.textContent = await this.rewriteCss(
          style.textContent ?? "",
          htmlDirectory
        );
      } catch (error) {
        this.warnings.push(
          `内联样式解析失败，已保留原文: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
      const css = element.getAttribute("style");
      if (!css) continue;
      try {
        const root = postcss.parse(`x{${css}}`);
        const rule = root.first;
        if (rule && "nodes" in rule) {
          await this.rewriteCssNodes(rule, htmlDirectory);
          element.setAttribute(
            "style",
            (rule.nodes ?? [])
              .map((node) => node.toString())
              .join(";")
          );
        }
      } catch (error) {
        this.warnings.push(
          `style 属性解析失败，已保留原文: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      html: serializeDocument(document),
      assets: this.records,
      warnings: this.warnings
    };
  }

  private async localizeReference(
    reference: string,
    baseDirectory: string
  ): Promise<string | undefined> {
    if (!isLocalReference(reference)) return undefined;
    let sourcePath: string;
    try {
      sourcePath = resolve(baseDirectory, decodeURIComponent(withoutQueryOrHash(reference)));
      if (!(await stat(sourcePath)).isFile()) return undefined;
    } catch {
      return undefined;
    }
    const existing = this.importedBySource.get(sourcePath);
    if (existing) return existing;

    const extension = extname(sourcePath).toLowerCase();
    if (extension === ".css") {
      // Reserve the source to break accidental circular @import chains.
      this.importedBySource.set(sourcePath, reference);
      const originalCss = await readFile(sourcePath, "utf8");
      let css = originalCss;
      try {
        css = await this.rewriteCss(originalCss, dirname(sourcePath));
      } catch (error) {
        this.warnings.push(
          `CSS ${sourcePath} 解析失败，已原样复制: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const data = Buffer.from(css, "utf8");
      return this.storeAsset(sourcePath, data, ".css");
    }
    return this.storeAsset(sourcePath, await readFile(sourcePath), extension);
  }

  private async storeAsset(
    sourcePath: string,
    data: Uint8Array,
    extension: string
  ): Promise<string> {
    const hash = sha256(data);
    const safeExtension = extension || "";
    const fileName = `${hash}${safeExtension}`;
    const relativeReference = `../assets/${fileName}`;
    await mkdir(join(this.projectRoot, "assets"), { recursive: true });
    await atomicWriteFile(join(this.projectRoot, "assets", fileName), data);
    this.importedBySource.set(sourcePath, relativeReference);
    this.records.push({
      id: `asset_${randomUUID()}`,
      sha256: hash,
      mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
      byteSize: data.byteLength,
      storedPath: `assets/${fileName}`,
      originalName: basename(sourcePath),
      originalUri: sourcePath
    });
    return relativeReference;
  }

  private async rewriteCss(css: string, baseDirectory: string): Promise<string> {
    const root = postcss.parse(css);
    await this.rewriteCssNodes(root, baseDirectory);
    return root.toString();
  }

  private async rewriteCssNodes(
    container: Container,
    baseDirectory: string
  ): Promise<void> {
    const declarations: Declaration[] = [];
    const imports: AtRule[] = [];
    container.walkDecls((declaration) => {
      declarations.push(declaration);
    });
    container.walkAtRules("import", (rule) => {
      imports.push(rule);
    });

    for (const declaration of declarations) {
      declaration.value = await this.rewriteCssValue(
        declaration.value,
        baseDirectory
      );
    }
    for (const rule of imports) {
      rule.params = await this.rewriteCssValue(rule.params, baseDirectory, true);
    }
  }

  private async rewriteCssValue(
    value: string,
    baseDirectory: string,
    importString = false
  ): Promise<string> {
    const parsed = valueParser(value);
    const targets: ValueNode[] = [];
    parsed.walk((node) => {
      if (node.type === "function" && node.value.toLowerCase() === "url") {
        targets.push(node);
      } else if (
        importString
        && node.type === "string"
        && targets.length === 0
      ) {
        targets.push(node);
      }
    });

    for (const target of targets) {
      const raw = target.type === "function"
        ? valueParser.stringify(target.nodes).trim().replace(/^['"]|['"]$/g, "")
        : target.value;
      const localized = await this.localizeReference(raw, baseDirectory);
      if (!localized) continue;
      if (target.type === "function") {
        target.nodes = [{ type: "word", value: localized, sourceIndex: 0, sourceEndIndex: localized.length }];
      } else {
        target.value = localized;
      }
    }
    return parsed.toString();
  }
}
