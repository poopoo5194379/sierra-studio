// SierraStudio Cloud Client
// Communicates with Cloudflare Workers (workers/api.ts)
// Architecture: Client edits locally → debounce saves full HTML to cloud.
// Undo/redo fetches versioned snapshots from R2.

const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL || "";
const FETCH_TIMEOUT = 5000; // 5 second max — never block the UI

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface CloudFile {
  fileId: string;
  name: string;
  revision: number;
}

class CloudClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    try {
      this.sessionId = localStorage.getItem("hs-cloud-session") || null;
    } catch { /* no localStorage */ }
  }

  get isEnabled(): boolean {
    return !!this.baseUrl;
  }

  // ── Session ──

  async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const res = await fetchWithTimeout(`${this.baseUrl}/api/session`, { method: "POST" });
    if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
    const data = await res.json();
    this.sessionId = data.sessionId;
    try { localStorage.setItem("hs-cloud-session", this.sessionId); } catch { /* */ }
    return this.sessionId;
  }

  // ── Upload new file ──

  async uploadHtml(html: string, name: string): Promise<CloudFile> {
    const form = new FormData();
    form.append("html", html);
    form.append("name", name);
    form.append("sessionId", await this.ensureSession());
    const res = await fetchWithTimeout(`${this.baseUrl}/api/files/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  }

  // ── Get latest HTML ──

  async getHtml(fileId: string): Promise<string> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/files/${fileId}/html`);
    if (!res.ok) throw new Error(`Get HTML failed: ${res.status}`);
    return res.text();
  }

  // ── Save snapshot (edit) ──

  async saveSnapshot(fileId: string, html: string, command?: unknown): Promise<{ revision: number }> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/files/${fileId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: await this.ensureSession(),
        html,
        command: command || null
      })
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    return res.json();
  }

  // ── Undo ──

  async undo(fileId: string): Promise<{ revision: number; html?: string }> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/files/${fileId}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: await this.ensureSession() })
    });
    if (!res.ok) throw new Error(`Undo failed: ${res.status}`);
    return res.json();
  }

  // ── Redo ──

  async redo(fileId: string): Promise<{ revision: number; html?: string }> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/files/${fileId}/redo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: await this.ensureSession() })
    });
    if (!res.ok) throw new Error(`Redo failed: ${res.status}`);
    return res.json();
  }

  // ── Crash ──

  async reportCrash(info: {
    errorMessage: string; errorStack?: string;
    appVersion?: string; platform?: string
  }): Promise<void> {
    try {
      await fetchWithTimeout(`${this.baseUrl}/api/crash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: this.sessionId || "unknown", ...info
        })
      });
    } catch { /* fire-and-forget */ }
  }
}

export const cloudClient = new CloudClient(CLOUD_API_URL);
