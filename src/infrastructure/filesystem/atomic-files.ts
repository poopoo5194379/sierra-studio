import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

function isTransientRenameError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["EPERM", "EBUSY", "EACCES"].includes(String(error.code));
}

async function renameWithRetry(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const attempts = process.platform === "win32" ? 18 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt === attempts - 1) {
        throw error;
      }
      // Windows: antivirus/indexer can hold a transient lock on the target
      // for several seconds; back off exponentially (capped) before retrying.
      await delay(Math.min(50 * 2 ** attempt, 1_000));
    }
  }
}

export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data);
    try {
      await renameWithRetry(temporaryPath, targetPath);
    } catch (renameError) {
      if (process.platform !== "win32" || !isTransientRenameError(renameError)) {
        throw renameError;
      }
      // Windows fallback: antivirus/indexer may pin the existing target
      // without FILE_SHARE_DELETE. Try remove-then-rename, and as a last
      // resort write the target directly (sacrifices atomicity, keeps data).
      try {
        await rm(targetPath, { force: true });
        await renameWithRetry(temporaryPath, targetPath);
      } catch {
        await writeFile(targetPath, data);
        await rm(temporaryPath, { force: true });
      }
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
