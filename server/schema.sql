-- D1 database schema for SierraStudio
-- Uses SQLite-compatible syntax (same as local version)

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  resulting_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  inverse_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_ops_project_revision ON operations(project_id, resulting_revision);
CREATE INDEX idx_ops_created ON operations(created_at);
