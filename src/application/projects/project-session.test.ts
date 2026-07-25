import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSafeWorkingDocument } from "../../domain/document/html-document";
import { ProjectSession } from "./project-session";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("ProjectSession recovery", () => {
  it("ignores a corrupt working copy and replays committed operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "html-studio-test-"));
    temporaryDirectories.push(root);
    const initial = createSafeWorkingDocument(
      "<html><body><p>Hello</p></body></html>"
    );
    const nodeId = initial.match(/<p data-hs-id="([^"]+)"/)?.[1];
    expect(nodeId).toBeTruthy();

    const session = await ProjectSession.create(
      root,
      "project_test",
      "document_test",
      initial
    );
    await session.execute({
      commandId: randomUUID(),
      commandVersion: 1,
      documentId: "document_test",
      baseRevision: 0,
      resultingRevision: 1,
      payload: {
        type: "text.set",
        nodeId,
        before: "Hello",
        after: "Recovered"
      }
    });
    session.close();

    await writeFile(join(root, "working", "index.html"), "CORRUPT");
    const recovered = await ProjectSession.open(root);
    expect(recovered.snapshot().html).toContain("Recovered");
    expect(recovered.snapshot().revision).toBe(1);
    expect(await readFile(join(root, "working", "index.html"), "utf8"))
      .toContain("Recovered");

    await recovered.undo();
    expect(recovered.snapshot().html).toContain("Hello");
    await recovered.redo();
    expect(recovered.snapshot().html).toContain("Recovered");
    recovered.close();
  });
});
