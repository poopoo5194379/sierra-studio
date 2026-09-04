import { DatabaseSync } from "node:sqlite";
import type { CommandEnvelope, CommandPayload } from "../../domain/commands/schema";

export interface StoredOperation {
  sequence: number;
  command: CommandEnvelope;
}

export interface StoredCheckpoint {
  revision: number;
  relativePath: string;
  sha256: string;
}

export interface AssetRecord {
  id: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  storedPath: string;
  originalName: string;
  originalUri: string;
}

export class ProjectDatabase {
  private static readonly SCHEMA_VERSION = 2;
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA synchronous = FULL");
    this.migrate();
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    const row = this.database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (row.user_version > ProjectDatabase.SCHEMA_VERSION) {
      throw new Error(
        `Project database version ${row.user_version} is newer than supported`
      );
    }
    let version = row.user_version;
    if (version === 0) {
      this.transaction(() => {
        this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL UNIQUE,
        command_version INTEGER NOT NULL,
        document_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        resulting_revision INTEGER NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        inverse_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        revision INTEGER PRIMARY KEY,
        relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        stored_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        original_uri TEXT,
        created_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, datetime('now'));
      PRAGMA user_version = 1;
      `);
      });
      version = 1;
    }
    if (version < 2) {
      this.transaction(() => {
        this.database.exec(`
        CREATE TABLE IF NOT EXISTS project_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (2, datetime('now'));
        PRAGMA user_version = 2;
        `);
      });
    }
  }

  initializeMetadata(entries: Record<string, string>): void {
    const insert = this.database.prepare(
      "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)"
    );
    this.transaction(() => {
      for (const [key, value] of Object.entries(entries)) insert.run(key, value);
    });
  }

  getMetadata(key: string): string | undefined {
    const row = this.database
      .prepare("SELECT value FROM metadata WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  getProjectSetting(key: string): unknown {
    const row = this.database.prepare(
      "SELECT value_json FROM project_settings WHERE key = ?"
    ).get(key) as { value_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return undefined;
    }
  }

  setProjectSetting(key: string, value: unknown): void {
    this.database.prepare(`
      INSERT INTO project_settings(key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), new Date().toISOString());
  }

  appendOperation(
    command: CommandEnvelope,
    inverse: CommandPayload
  ): string[] {
    const abandonedCheckpoints = this.database.prepare(`
      SELECT relative_path
      FROM checkpoints
      WHERE revision > ?
    `).all(command.baseRevision) as Array<{ relative_path: string }>;
    const insert = this.database.prepare(`
      INSERT INTO operations(
        command_id, command_version, document_id, base_revision,
        resulting_revision, payload_json, inverse_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateHead = this.database.prepare(
      "INSERT OR REPLACE INTO metadata(key, value) VALUES ('head_revision', ?)"
    );
    const updateMax = this.database.prepare(
      "INSERT OR REPLACE INTO metadata(key, value) VALUES ('max_revision', ?)"
    );
    const pruneOperations = this.database.prepare(
      "DELETE FROM operations WHERE resulting_revision > ?"
    );
    const pruneCheckpoints = this.database.prepare(
      "DELETE FROM checkpoints WHERE revision > ?"
    );
    this.transaction(() => {
      pruneOperations.run(command.baseRevision);
      pruneCheckpoints.run(command.baseRevision);
      insert.run(
        command.commandId,
        command.commandVersion,
        command.documentId,
        command.baseRevision,
        command.resultingRevision,
        JSON.stringify(command.payload),
        JSON.stringify(inverse),
        new Date().toISOString()
      );
      updateHead.run(String(command.resultingRevision));
      updateMax.run(String(command.resultingRevision));
    });
    return abandonedCheckpoints.map((row) => row.relative_path);
  }

  getOperationsAfter(revision: number, throughRevision: number): StoredOperation[] {
    const rows = this.database.prepare(`
      SELECT sequence, command_id, command_version, document_id,
             base_revision, resulting_revision, payload_json
      FROM operations
      WHERE resulting_revision > ? AND resulting_revision <= ?
      ORDER BY resulting_revision ASC
    `).all(revision, throughRevision) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      sequence: Number(row.sequence),
      command: {
        commandId: String(row.command_id),
        commandVersion: 1,
        documentId: String(row.document_id),
        baseRevision: Number(row.base_revision),
        resultingRevision: Number(row.resulting_revision),
        payload: JSON.parse(String(row.payload_json)) as CommandPayload
      }
    }));
  }

  /**
   * Fetch the inverse of the operation whose resulting_revision equals `revision`.
   * Used by undo/redo to apply the inverse in-place on the live DOM
   * (instead of reloading the iframe).
   */
  getInverseAt(revision: number): CommandPayload | null {
    const row = this.database.prepare(`
      SELECT inverse_json
      FROM operations
      WHERE resulting_revision = ?
    `).get(revision) as { inverse_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.inverse_json) as CommandPayload;
  }

  /**
   * Fetch the original (forward) payload of the operation whose
   * resulting_revision equals `revision`. Used by redo to re-apply it.
   */
  getPayloadAt(revision: number): CommandPayload | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM operations
      WHERE resulting_revision = ?
    `).get(revision) as { payload_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.payload_json) as CommandPayload;
  }

  addCheckpoint(checkpoint: StoredCheckpoint): void {
    this.database.prepare(`
      INSERT OR REPLACE INTO checkpoints(
        revision, relative_path, sha256, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(
      checkpoint.revision,
      checkpoint.relativePath,
      checkpoint.sha256,
      new Date().toISOString()
    );
  }

  pruneCheckpoints(keepRecent: number): string[] {
    const rows = this.database.prepare(`
      SELECT revision, relative_path
      FROM checkpoints
      ORDER BY revision DESC
    `).all() as Array<{ revision: number; relative_path: string }>;
    const keep = new Set([
      0,
      ...rows.filter((row) => row.revision !== 0)
        .slice(0, keepRecent)
        .map((row) => row.revision)
    ]);
    const removed = rows.filter((row) => !keep.has(row.revision));
    const statement = this.database.prepare(
      "DELETE FROM checkpoints WHERE revision = ?"
    );
    this.transaction(() => {
      for (const row of removed) statement.run(row.revision);
    });
    return removed.map((row) => row.relative_path);
  }

  addAssets(assets: AssetRecord[]): void {
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO assets(
        id, sha256, mime_type, byte_size, stored_path,
        original_name, original_uri, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.transaction(() => {
      for (const asset of assets) {
        insert.run(
          asset.id,
          asset.sha256,
          asset.mimeType,
          asset.byteSize,
          asset.storedPath,
          asset.originalName,
          asset.originalUri,
          new Date().toISOString()
        );
      }
    });
  }

  getLatestCheckpoint(headRevision: number): StoredCheckpoint | undefined {
    const row = this.database.prepare(`
      SELECT revision, relative_path, sha256
      FROM checkpoints
      WHERE revision <= ?
      ORDER BY revision DESC
      LIMIT 1
    `).get(headRevision) as
      | { revision: number; relative_path: string; sha256: string }
      | undefined;
    return row && {
      revision: row.revision,
      relativePath: row.relative_path,
      sha256: row.sha256
    };
  }

  setHeadRevision(revision: number): void {
    this.database.prepare(
      "INSERT OR REPLACE INTO metadata(key, value) VALUES ('head_revision', ?)"
    ).run(String(revision));
  }

  close(): void {
    this.database.close();
  }
}
