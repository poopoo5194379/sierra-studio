const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { brotliDecompressSync } = require("node:zlib");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { parseHTML } = require("linkedom");

const projectId = process.env.SIERRASTUDIO_REPAIR_PROJECT_ID;
const nodeId = process.env.SIERRASTUDIO_REPAIR_NODE_ID;
const userData = process.env.SIERRASTUDIO_REPAIR_USER_DATA;
if (!projectId || !nodeId || !userData) {
  throw new Error(
    "Set SIERRASTUDIO_REPAIR_PROJECT_ID, SIERRASTUDIO_REPAIR_NODE_ID and "
      + "SIERRASTUDIO_REPAIR_USER_DATA."
  );
}

const root = path.join(__dirname, "..");
const projectRoot = path.join(userData, "projects", projectId);
const metadata = JSON.parse(
  readFileSync(path.join(projectRoot, "project.json"), "utf8")
);
const checkpointHtml = brotliDecompressSync(
  readFileSync(path.join(projectRoot, "snapshots", "checkpoint-00000000.br"))
).toString("utf8");
const workingPath = path.join(projectRoot, "working", "index.html");
const workingHtml = readFileSync(workingPath, "utf8");
const checkpointDocument = parseHTML(checkpointHtml).document;
const workingDocument = parseHTML(workingHtml).document;
const selector = `[data-hs-id="${nodeId.replaceAll('"', '\\"')}"]`;
const checkpointNode = checkpointDocument.querySelector(selector);
const workingNode = workingDocument.querySelector(selector);
if (!checkpointNode || !workingNode) {
  throw new Error(`Cannot locate ${nodeId} in checkpoint and working HTML.`);
}
if (checkpointNode.innerHTML === workingNode.innerHTML) {
  console.log(JSON.stringify({ repaired: false, reason: "already-restored" }));
  process.exit(0);
}

const executable = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);

(async () => {
  const app = await electron.launch({
    executablePath: executable,
    args: [root, "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      SIERRASTUDIO_USER_DATA_DIR: userData
    }
  });
  try {
    const window = await app.firstWindow();
    const snapshot = await window.evaluate(
      (targetProjectId) => window.sierraStudio.openProject(targetProjectId),
      projectId
    );
    const result = await window.evaluate(
      (input) => window.sierraStudio.executeCommand(input),
      {
        projectId,
        command: {
          commandId: randomUUID(),
          commandVersion: 1,
          documentId: metadata.documentId,
          baseRevision: snapshot.revision,
          resultingRevision: snapshot.revision + 1,
          payload: {
            type: "text.patchStyle",
            nodeId,
            before: workingNode.innerHTML,
            after: checkpointNode.innerHTML
          }
        }
      }
    );
    const verified = await window.evaluate(
      (targetProjectId) => window.sierraStudio.openProject(targetProjectId),
      projectId
    );
    console.log(JSON.stringify({
      repaired: true,
      revision: result.revision,
      verifiedRevision: verified.revision,
      restoredCharacters: checkpointNode.innerHTML.length
    }));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
