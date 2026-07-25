export type ResizeDirection =
  | "nw" | "n" | "ne"
  | "w"  | "e"
  | "sw" | "s" | "se";

const HANDLE_POSITION: Record<ResizeDirection, { x: string; y: string; cx: string; cy: string }> = {
  nw: { x: "-5px",  y: "-5px",  cx: "left",   cy: "top" },
  n:  { x: "50%",   y: "-5px",  cx: "center", cy: "top" },
  ne: { x: "-5px",  y: "-5px",  cx: "right",  cy: "top" },
  w:  { x: "-5px",  y: "50%",   cx: "left",   cy: "center" },
  e:  { x: "-5px",  y: "50%",   cx: "right",  cy: "center" },
  sw: { x: "-5px",  y: "-5px",  cx: "left",   cy: "bottom" },
  s:  { x: "50%",   y: "-5px",  cx: "center", cy: "bottom" },
  se: { x: "-5px",  y: "-5px",  cx: "right",  cy: "bottom" }
};

const RESIZE_CURSORS: Record<ResizeDirection, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize",
  w: "ew-resize",    e: "ew-resize",
  sw: "nesw-resize", s: "ns-resize", se: "nwse-resize"
};

/** Mimics GrapesJS SelectComponent handles: 4 corners (8x8) + 4 midpoints (6x16 or 16x6) */
function buildHandle(dir: ResizeDirection): HTMLDivElement {
  const h = document.createElement("div");
  h.className = "hs-resize-handle";
  h.dataset.hsResizeHandle = "";
  h.dataset.hsResizeDir = dir;
  const isCorner = dir.length === 2;
  const size = isCorner ? "10px" : dir === "n" || dir === "s" ? "6px" : "6px";
  const wide = isCorner ? "10px" : dir === "n" || dir === "s" ? "16px" : "6px";
  const tall = isCorner ? "10px" : dir === "n" || dir === "s" ? "6px" : "16px";
  Object.assign(h.style, {
    position: "absolute",
    width: wide, height: tall,
    background: isCorner ? "#4f7cff" : "#fff",
    border: isCorner ? "2px solid #fff" : "1px solid #4f7cff",
    borderRadius: isCorner ? "2px" : "1px",
    pointerEvents: "auto",
    cursor: RESIZE_CURSORS[dir],
    boxSizing: "border-box",
    zIndex: "2"
  });
  return h;
}

export class SelectionOverlay {
  private readonly root: HTMLDivElement;
  private readonly handles: Map<ResizeDirection, HTMLDivElement> = new Map();
  private readonly boxEls: HTMLDivElement[] = [];
  private readonly directions = Object.keys(HANDLE_POSITION) as ResizeDirection[];

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.hsOverlay = "";
    Object.assign(this.root.style, {
      position: "fixed", pointerEvents: "none", inset: "0", zIndex: "2147483646"
    });
    for (const dir of this.directions) {
      const handle = buildHandle(dir);
      this.handles.set(dir, handle);
      this.root.appendChild(handle);
    }
    document.documentElement.appendChild(this.root);
  }

  isResizeHandle(target: EventTarget | null): ResizeDirection | null {
    if (!(target instanceof HTMLElement)) return null;
    const h = target.closest<HTMLElement>("[data-hs-resize-handle]");
    return (h?.dataset?.hsResizeDir as ResizeDirection | undefined) ?? null;
  }

  update(targets: HTMLElement[], primary: HTMLElement | null): void {
    // --- selection boxes ---
    while (this.boxEls.length < targets.length) {
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed", pointerEvents: "none",
        border: "2px solid #4f7cff", borderRadius: "2px", boxSizing: "border-box"
      });
      this.root.appendChild(box);
      this.boxEls.push(box);
    }
    this.boxEls.forEach((box, i) => {
      const el = targets[i];
      if (!el?.isConnected) { box.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        display: "block",
        borderStyle: el === primary ? "solid" : "dashed",
        left: `${r.left}px`, top: `${r.top}px`,
        width: `${r.width}px`, height: `${r.height}px`
      });
    });

    // --- 8 resize handles ---
    for (const h of this.handles.values()) h.style.display = "none";
    if (!primary?.isConnected) return;
    const rect = primary.getBoundingClientRect();
    for (const dir of this.directions) {
      const handle = this.handles.get(dir)!;
      const pos = HANDLE_POSITION[dir];
      const left = pos.cx === "left" ? rect.left : pos.cx === "right" ? rect.right - 5 : rect.left + rect.width / 2 - 5;
      const top = pos.cy === "top" ? rect.top : pos.cy === "bottom" ? rect.bottom - 5 : rect.top + rect.height / 2 - 5;
      handle.style.display = "block";
      handle.style.left = `${left}px`;
      handle.style.top = `${top}px`;
    }
  }
}
