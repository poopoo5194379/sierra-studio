// Anonymous Session Manager — one UUID per device, no login required.
// The sessionId is persisted in Electron's userData folder.
// Used by the cloud backend to associate files and operations with a device.

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

const SESSION_FILE = "session.json";

interface SessionData {
  sessionId: string;
  createdAt: string;
}

let cachedSession: SessionData | null = null;

function getSessionPath(): string {
  return path.join(app.getPath("userData"), SESSION_FILE);
}

export function getSessionId(): string {
  if (cachedSession) return cachedSession.sessionId;

  const filePath = getSessionPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      cachedSession = JSON.parse(raw) as SessionData;
      return cachedSession.sessionId;
    }
  } catch {
    // Corrupted — regenerate
  }

  // Create new session
  const session: SessionData = {
    sessionId: randomUUID(),
    createdAt: new Date().toISOString()
  };

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    cachedSession = session;
  } catch {
    // No persistence available — still usable for this session
    cachedSession = session;
  }

  return session.sessionId;
}
