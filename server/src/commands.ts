// Command payload types — mirroring src/domain/commands/schema.ts
// but simplified for Cloudflare Workers (no zod on edge)

export interface StyleDeclaration {
  property: string;
  value: string;
  priority?: string;
  existed?: boolean;
}

export interface CommandPayloadMap {
  "styles.set": {
    type: "styles.set";
    nodes: Array<{
      nodeId: string;
      before: StyleDeclaration[];
      after: StyleDeclaration[];
    }>;
  };
  "text.set": {
    type: "text.set";
    nodeId: string;
    before: string;
    after: string;
  };
  "text.patchStyle": {
    type: "text.patchStyle";
    nodeId: string;
    before: string;
    after: string;
  };
  "attribute.set": {
    type: "attribute.set";
    nodeId: string;
    name: string;
    before: string | null;
    after: string;
  };
  "node.insert": {
    type: "node.insert";
    parentId: string;
    index: number;
    node: {
      id: string;
      tagName: "img" | "div" | "p" | "span" | "h1" | "h2" | "h3" | "hr" | "button";
      attributes: Record<string, string>;
      text: string;
    };
  };
  "node.delete": {
    type: "node.delete";
    parentId: string;
    index: number;
    nodeId: string;
    node: {
      id: string;
      tagName: "img" | "div" | "p" | "span" | "h1" | "h2" | "h3" | "hr" | "button";
      attributes: Record<string, string>;
      text: string;
    };
  };
  "chart.patch": {
    type: "chart.patch";
    chartKey: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
}

export type CommandPayload = CommandPayloadMap[keyof CommandPayloadMap];

/** Generate the inverse of a command (for undo support) */
export function invertPayload(payload: CommandPayload): CommandPayload {
  switch (payload.type) {
    case "styles.set":
      return {
        type: "styles.set",
        nodes: payload.nodes.map((n) => ({
          nodeId: n.nodeId,
          before: n.after,
          after: n.before
        }))
      };
    case "text.set":
      return { ...payload, before: payload.after, after: payload.before };
    case "text.patchStyle":
      return { ...payload, before: payload.after, after: payload.before };
    case "attribute.set":
      return { ...payload, before: payload.after, after: payload.before ?? "" };
    case "node.insert":
      return {
        type: "node.delete",
        parentId: payload.parentId,
        index: payload.index,
        nodeId: payload.node.id,
        node: payload.node
      };
    case "node.delete":
      return {
        type: "node.insert",
        parentId: payload.parentId,
        index: payload.index,
        node: payload.node
      };
    case "chart.patch":
      return { ...payload, before: payload.after, after: payload.before };
  }
}

/** Apply a command to an HTML string (lightweight DOM-less implementation). */
export function applyCommandToHtml(html: string, payload: CommandPayload): string {
  // For text/text.patchStyle, use simple string replacement on inner text nodes
  // Note: This is a simplified version. Full DOM parsing would need linkedom.
  switch (payload.type) {
    case "text.set": {
      // Replace node's text content (naive: replace inner text of the element)
      const regex = new RegExp(
        `(<[^>]+data-hs-id="${escapeRegExp(payload.nodeId)}"[^>]*>)[^<]*(</[^>]*>)`,
        "i"
      );
      return html.replace(regex, `$1${escapeHtml(payload.after)}$2`);
    }
    case "text.patchStyle": {
      const regex = new RegExp(
        `(<[^>]+data-hs-id="${escapeRegExp(payload.nodeId)}"[^>]*>)[\\s\\S]*?(</[^>]*>)`,
        "i"
      );
      return html.replace(regex, `$1${payload.after}$2`);
    }
    case "attribute.set": {
      const regex = new RegExp(
        `(<[^>]+data-hs-id="${escapeRegExp(payload.nodeId)}"[^>]*?)\\s+${escapeRegExp(payload.name)}="[^"]*"`,
        "i"
      );
      if (regex.test(html)) {
        return html.replace(regex, `$1 ${payload.name}="${escapeHtml(payload.after)}"`);
      }
      // Attribute doesn't exist yet — add it
      const addRegex = new RegExp(
        `(<[^>]+data-hs-id="${escapeRegExp(payload.nodeId)}"[^>]*)(>)`,
        "i"
      );
      return html.replace(addRegex, `$1 ${payload.name}="${escapeHtml(payload.after)}"$2`);
    }
    default:
      // styles.set / node.insert/delete — need full DOM parsing
      // For MVP, log and skip; full DOM support via linkedom in Phase 2
      console.warn(`[applyCommand] unimplemented command type: ${payload.type}`);
      return html;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
