import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectManager } from "./project-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("ProjectManager", () => {
  it("creates one editable welcome project for a new installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sierra-project-manager-"));
    temporaryDirectories.push(root);
    const manager = new ProjectManager(join(root, "projects"));

    const [first, second] = await Promise.all([
      manager.ensureWelcomeProject(),
      manager.ensureWelcomeProject()
    ]);

    expect(first.projectId).toBe(second.projectId);
    expect(first.name).toBe("SierraStudio 入门样例");
    expect(await manager.listProjects()).toHaveLength(1);
    manager.close();
  });

  it("lists and reopens imported projects after a process restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "sierra-project-manager-"));
    temporaryDirectories.push(root);
    const projectsRoot = join(root, "projects");
    const sourcePath = join(root, "annual-report.html");
    await writeFile(
      sourcePath,
      "<!doctype html><html><body><h1>Annual report</h1></body></html>",
      "utf8"
    );

    const firstManager = new ProjectManager(projectsRoot);
    const imported = await firstManager.importHtml(sourcePath);
    firstManager.close();

    const secondManager = new ProjectManager(projectsRoot);
    const listed = await secondManager.listProjects();
    expect(listed).toEqual([expect.objectContaining({
      projectId: imported.projectId,
      name: "annual-report"
    })]);
    const reopened = await secondManager.openProject(imported.projectId);
    expect(reopened.projectId).toBe(imported.projectId);
    expect(reopened.documentId).toBe(imported.documentId);
    expect(reopened.revision).toBe(0);
    secondManager.close();
  });

  it("embeds imported images as Base64 data URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "sierra-project-manager-"));
    temporaryDirectories.push(root);
    const manager = new ProjectManager(join(root, "projects"));
    const project = await manager.ensureWelcomeProject();
    const sourcePath = join(root, "pixel.png");
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(sourcePath, imageBytes);

    const imageSource = await manager.importImage(project.projectId, sourcePath);

    expect(imageSource).toBe(
      `data:image/png;base64,${imageBytes.toString("base64")}`
    );
    manager.close();
  });

  it("preserves the selected order when embedding multiple images", async () => {
    const root = await mkdtemp(join(tmpdir(), "sierra-project-manager-"));
    temporaryDirectories.push(root);
    const manager = new ProjectManager(join(root, "projects"));
    const project = await manager.ensureWelcomeProject();
    const firstPath = join(root, "01.png");
    const secondPath = join(root, "02.jpg");
    await writeFile(firstPath, Buffer.from([1, 2, 3]));
    await writeFile(secondPath, Buffer.from([4, 5, 6]));

    const images = await manager.importImages(project.projectId, [
      secondPath,
      firstPath
    ]);

    expect(images.map((image) => image.originalName)).toEqual([
      "02.jpg",
      "01.png"
    ]);
    expect(images[0]?.imageSource).toMatch(/^data:image\/jpeg;base64,/);
    expect(images[1]?.imageSource).toMatch(/^data:image\/png;base64,/);
    manager.close();
  });
});
