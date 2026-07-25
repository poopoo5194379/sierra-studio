import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { AssetImporter } from "../src/infrastructure/import/asset-importer";
import { createSafeWorkingDocument } from "../src/domain/document/html-document";
import { ProjectSession } from "../src/application/projects/project-session";
import { newDocumentId, newProjectId } from "../src/shared/ids";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Pass an HTML path");

const destination = await mkdtemp(join(tmpdir(), "html-studio-diagnose-"));
console.log({ sourcePath, destination });
console.time("read");
try {
  const source = await readFile(sourcePath, "utf8");
  console.timeEnd("read");
  console.time("assets");
  const localized = await new AssetImporter(destination).importHtml(
    sourcePath,
    source
  );
  console.timeEnd("assets");
  console.time("safe-document");
  const html = createSafeWorkingDocument(localized.html);
  console.timeEnd("safe-document");
  console.time("session");
  const session = await ProjectSession.create(
    destination,
    newProjectId(),
    newDocumentId(),
    html,
    localized.assets
  );
  console.timeEnd("session");
  console.log({
    revision: session.snapshot().revision,
    htmlLength: session.snapshot().html.length,
    warnings: localized.warnings
  });
  session.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
