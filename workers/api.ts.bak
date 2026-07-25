// SierraStudio Cloud API — Cloudflare Workers + D1 + R2
// Architecture: Client maintains editing state, sends full HTML snapshots.
// Server stores version history + command logs for undo/redo.
//
// Endpoints:
//   POST /api/session              — create anonymous session
//   POST /api/files/upload          — upload HTML + assets
//   POST /api/files/:fileId/save     — save HTML snapshot + command log (increment revision)
//   POST /api/files/:fileId/undo     — returns previous HTML + decrements revision
//   POST /api/files/:fileId/redo     — returns next HTML + increments revision
//   GET  /api/files/:fileId/html     — get latest HTML
//   POST /api/crash                  — report crash/error
//   GET  /api/files/:fileId/stats    — get file stats

interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
}

function uuid(): string {
  return crypto.randomUUID();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function textResponse(body: string, contentType = "text/html"): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// === Router ===

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Session-Id"
        }
      });
    }

    try {
      // ── Session ──
      if (path === "/api/session" && request.method === "POST") {
        const id = uuid();
        await env.DB.prepare("INSERT INTO sessions (id) VALUES (?)").bind(id).run();
        return json({ sessionId: id });
      }

      // ── Upload (first time) ──
      if (path === "/api/files/upload" && request.method === "POST") {
        const form = await request.formData();
        const html = form.get("html") as string;
        const name = (form.get("name") as string) || "untitled";
        const sessionId = form.get("sessionId") as string || "";

        if (!html) return json({ error: "html is required" }, 400);

        const fileId = uuid();
        // Store initial version
        await env.STORAGE.put(`files/${fileId}/v0.html`, html);
        // Set latest pointer
        await env.STORAGE.put(`files/${fileId}/latest.html`, html);

        await env.DB.prepare(
          "INSERT INTO files (id, session_id, name, revision) VALUES (?, ?, ?, 0)"
        ).bind(fileId, sessionId, name).run();

        return json({ fileId, name, revision: 0 });
      }

      // ── Save (edit: HTML snapshot + command log) ──
      const saveMatch = path.match(/^\/api\/files\/([^\/]+)\/save$/);
      if (saveMatch && request.method === "POST") {
        const fileId = saveMatch[1];
        const { html, command, sessionId: sid } = await request.json() as any;
        const sessionId = sid || request.headers.get("X-Session-Id") || "";

        if (!html) return json({ error: "html is required" }, 400);

        const file = await env.DB.prepare("SELECT revision FROM files WHERE id = ?")
          .bind(fileId).first<{ revision: number }>();
        if (!file) return json({ error: "file not found" }, 404);

        const newRev = file.revision + 1;

        // Store the HTML snapshot at this revision
        await env.STORAGE.put(`files/${fileId}/v${newRev}.html`, html);
        // Update latest pointer
        await env.STORAGE.put(`files/${fileId}/latest.html`, html);

        // Store command log for undo
        const inverse = command ? invertCommand(command) : null;
        await env.DB.prepare(
          `INSERT INTO operations (file_id, session_id, resulting_revision, payload_json, inverse_json)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(fileId, sessionId, newRev, command ? JSON.stringify(command) : "{}", inverse ? JSON.stringify(inverse) : "{}").run();

        // Update revision
        await env.DB.prepare(
          "UPDATE files SET revision = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(newRev, fileId).run();

        return json({ revision: newRev, ok: true });
      }

      // ── Get HTML ──
      const htmlMatch = path.match(/^\/api\/files\/([^\/]+)\/html$/);
      if (htmlMatch && request.method === "GET") {
        const fileId = htmlMatch[1];
        const obj = await env.STORAGE.get(`files/${fileId}/latest.html`);
        if (!obj) return json({ error: "file not found" }, 404);
        return textResponse(await obj.text());
      }

      // ── Get HTML at specific revision ──
      const revMatch = path.match(/^\/api\/files\/([^\/]+)\/html\/(\d+)$/);
      if (revMatch && request.method === "GET") {
        const fileId = revMatch[1];
        const rev = revMatch[2];
        const obj = await env.STORAGE.get(`files/${fileId}/v${rev}.html`);
        if (!obj) return json({ error: "revision not found" }, 404);
        return textResponse(await obj.text());
      }

      // ── Undo (return previous HTML) ──
      const undoMatch = path.match(/^\/api\/files\/([^\/]+)\/undo$/);
      if (undoMatch && request.method === "POST") {
        const fileId = undoMatch[1];

        const file = await env.DB.prepare("SELECT revision FROM files WHERE id = ?")
          .bind(fileId).first<{ revision: number }>();
        if (!file || file.revision === 0) return json({ revision: 0 });

        const prevRev = file.revision - 1;
        const obj = await env.STORAGE.get(`files/${fileId}/v${prevRev}.html`);
        const html = obj ? await obj.text() : null;

        // Get inverse for the frontend to know what was undone
        const op = await env.DB.prepare(
          "SELECT inverse_json FROM operations WHERE file_id = ? AND resulting_revision = ?"
        ).bind(fileId, file.revision).first<{ inverse_json: string }>();

        // Update latest to the previous version
        if (html) {
          await env.STORAGE.put(`files/${fileId}/latest.html`, html);
        }

        // Decrement revision
        await env.DB.prepare(
          "UPDATE files SET revision = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(prevRev, fileId).run();

        return json({
          revision: prevRev,
          html,
          inverse: op ? safeParse(op.inverse_json) : null
        });
      }

      // ── Redo (return next HTML) ──
      const redoMatch = path.match(/^\/api\/files\/([^\/]+)\/redo$/);
      if (redoMatch && request.method === "POST") {
        const fileId = redoMatch[1];

        const file = await env.DB.prepare("SELECT revision FROM files WHERE id = ?")
          .bind(fileId).first<{ revision: number }>();
        if (!file) return json({ revision: 0 });

        const maxRev = await env.DB.prepare(
          "SELECT MAX(resulting_revision) as max_rev FROM operations WHERE file_id = ?"
        ).bind(fileId).first<{ max_rev: number }>();

        if (!maxRev || file.revision >= maxRev.max_rev) {
          return json({ revision: file.revision });
        }

        const nextRev = file.revision + 1;
        const obj = await env.STORAGE.get(`files/${fileId}/v${nextRev}.html`);
        const html = obj ? await obj.text() : null;

        if (html) {
          await env.STORAGE.put(`files/${fileId}/latest.html`, html);
        }

        const op = await env.DB.prepare(
          "SELECT payload_json FROM operations WHERE file_id = ? AND resulting_revision = ?"
        ).bind(fileId, nextRev).first<{ payload_json: string }>();

        await env.DB.prepare(
          "UPDATE files SET revision = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(nextRev, fileId).run();

        return json({
          revision: nextRev,
          html,
          forward: op ? safeParse(op.payload_json) : null
        });
      }

      // ── Stats ──
      const statsMatch = path.match(/^\/api\/files\/([^\/]+)\/stats$/);
      if (statsMatch && request.method === "GET") {
        const fileId = statsMatch[1];
        const file = await env.DB.prepare(
          "SELECT id, name, revision, created_at, updated_at FROM files WHERE id = ?"
        ).bind(fileId).first();
        if (!file) return json({ error: "file not found" }, 404);
        return json(file);
      }

      // ── Admin Dashboard ──
      if (path === "/admin" && request.method === "GET") {
        return new Response(adminHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      }
      if (path === "/api/admin/stats" && request.method === "GET") {
        const [sessions, files, ops, crashes] = await Promise.all([
          env.DB.prepare("SELECT count(*) as c FROM sessions").first<{c:number}>(),
          env.DB.prepare("SELECT count(*) as c FROM files").first<{c:number}>(),
          env.DB.prepare("SELECT count(*) as c FROM operations").first<{c:number}>(),
          env.DB.prepare("SELECT count(*) as c FROM crashes").first<{c:number}>(),
        ]);
        return json({ sessions: sessions?.c||0, files: files?.c||0, operations: ops?.c||0, crashes: crashes?.c||0 });
      }
      if (path === "/api/admin/crashes" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT * FROM crashes ORDER BY created_at DESC LIMIT 50"
        ).all();
        return json(rows.results);
      }
      if (path === "/api/admin/files" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT id, session_id, name, revision, created_at, updated_at FROM files ORDER BY created_at DESC LIMIT 50"
        ).all();
        return json(rows.results);
      }
      if (path === "/api/admin/sessions" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT 50"
        ).all();
        return json(rows.results);
      }

      // ── Crash ──
      if (path === "/api/crash" && request.method === "POST") {
        const body = await request.json() as any;
        const crashId = uuid();
        await env.DB.prepare(
          `INSERT INTO crashes (id, session_id, app_version, platform, error_message, error_stack)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crashId,
          body.sessionId || "",
          body.appVersion || "",
          body.platform || "",
          body.errorMessage || body.message || "Unknown error",
          body.errorStack || body.stack || null
        ).run();
        return json({ crashId });
      }

      return json({ error: "not found" }, 404);
    } catch (err: any) {
      console.error("[api error]", err);
      return json({ error: err.message || "internal error" }, 500);
    }
  }
};

// === Helpers ===

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

function invertCommand(cmd: any): any {
  const type = cmd?.type;
  switch (type) {
    case "styles.set":
      return {
        ...cmd,
        nodes: cmd.nodes?.map((n: any) => ({
          ...n, before: n.after, after: n.before
        })) ?? []
      };
    case "text.set":
    case "text.patchStyle":
      return { ...cmd, before: cmd.after, after: cmd.before };
    case "attribute.set":
      return { ...cmd, before: cmd.after, after: cmd.before };
    case "node.insert":
      // Convert to delete — need the node's id
      return {
        type: "node.delete",
        nodeId: cmd.node?.id ?? "",
        parentId: cmd.parentId ?? "",
        index: cmd.index ?? 0,
        node: cmd.node  // keep node data for redo
      };
    case "node.delete":
      return {
        type: "node.insert",
        parentId: cmd.parentId ?? "",
        index: cmd.index ?? 0,
        node: cmd.node
      };
    case "node.move":
      return {
        ...cmd,
        beforeIndex: cmd.afterIndex,
        afterIndex: cmd.beforeIndex
      };
    default:
      return { ...cmd, before: cmd.after, after: cmd.before };
  }
}

// ── Minimal Admin Dashboard (embedded) ──
function adminHtml(): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SierraStudio Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#f5f7fa;color:#1a1a2e}header{background:#1a1a2e;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:10px}h1{font-size:1.2rem}nav{display:flex;background:#2a2e3a;padding:0 20px}nav button{padding:10px 16px;background:none;border:none;color:#aab;cursor:pointer;font-size:.85rem;border-bottom:2px solid transparent}nav button.active{color:#4f7cff;border-bottom-color:#4f7cff}main{max-width:1000px;margin:20px auto;padding:0 20px}.card{background:#fff;border-radius:8px;padding:18px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h2{font-size:.95rem;margin-bottom:10px;color:#4f7cff}table{width:100%;border-collapse:collapse;font-size:.8rem}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}th{color:#666;font-weight:600}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.stat{background:#f0f4ff;border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:1.6rem;font-weight:700;color:#4f7cff}.stat .l{font-size:.75rem;color:#888;margin-top:3px}.loading{padding:30px;text-align:center;color:#999}</style></head><body><header><span style="font-size:1.3rem">☁️</span><h1>SierraStudio</h1></header><nav><button class="active" onclick="t('dash',this)">仪表盘</button><button onclick="t('files',this)">文件</button><button onclick="t('crash',this)">错误日志</button><button onclick="t('sess',this)">设备</button></nav><main id="m"><div class="loading">加载中...</div></main><script>
async function f(p){const r=await fetch(p);return r.ok?r.json():{error:r.status}}
async function dash(){const d=await f("/api/admin/stats");m.innerHTML='<div class="stats"><div class="stat"><div class="n">'+d.sessions+'</div><div class="l">活跃设备</div></div><div class="stat"><div class="n">'+d.files+'</div><div class="l">上传文件</div></div><div class="stat"><div class="n">'+d.operations+'</div><div class="l">编辑操作</div></div><div class="stat"><div class="n">'+d.crashes+'</div><div class="l">错误报告</div></div></div>'}
async function files(){const d=await f("/api/admin/files");if(d.error){m.innerHTML='<div class="card">'+d.error+'</div>';return}m.innerHTML='<div class="card"><h2>文件列表 ('+d.length+')</h2><table><tr><th>名称</th><th>版本</th><th>创建时间</th><th>操作</th></tr>'+d.map(r=>'<tr><td>'+e(r.name)+'</td><td>'+r.revision+'</td><td>'+r.created_at.slice(0,16)+'</td><td><a href="/api/files/'+r.id+'/html" target=_blank>查看</a></td></tr>').join('')+'</table></div>'}
async function crash(){const d=await f("/api/admin/crashes");if(d.error){m.innerHTML='<div class="card">'+d.error+'</div>';return}m.innerHTML='<div class="card"><h2>错误日志 ('+d.length+')</h2><table><tr><th>时间</th><th>版本</th><th>错误信息</th></tr>'+d.map(r=>'<tr><td>'+r.created_at.slice(0,16)+'</td><td>'+e(r.app_version)+'</td><td title="'+e(r.error_stack||"")+'">'+e(r.error_message).slice(0,100)+'</td></tr>').join('')+'</table></div>'}
async function sess(){const d=await f("/api/admin/sessions");if(d.error){m.innerHTML='<div class="card">'+d.error+'</div>';return}m.innerHTML='<div class="card"><h2>设备列表 ('+d.length+')</h2><table><tr><th>设备ID</th><th>首次连接</th><th>最后活动</th></tr>'+d.map(r=>'<tr><td>'+r.id.slice(0,12)+'...</td><td>'+r.created_at.slice(0,16)+'</td><td>'+r.last_seen_at.slice(0,16)+'</td></tr>').join('')+'</table></div>'}
function t(n,b){document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");if(n=="dash")dash();else if(n=="files")files();else if(n=="crash")crash();else if(n=="sess")sess()}
function e(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
dash()
</script></body></html>`;
}
