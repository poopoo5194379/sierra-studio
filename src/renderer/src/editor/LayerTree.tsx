// GrapesJS-inspired LayerTree: recursive tree component for the sidebar

import type { LayerNode } from "../../../editor-runtime/protocol";

interface Props {
  nodes: LayerNode[];
  onSelect: (nodeId: string) => void;
  selectedId: string | null;
  depth?: number;
}

export function LayerTree({ nodes, onSelect, selectedId, depth = 0 }: Props) {
  return (
    <ul className="layer-tree" style={{ paddingLeft: depth > 0 ? 12 : 0, margin: 0, listStyle: "none", fontSize: 11 }}>
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            className={selectedId === node.id ? "layer-item active" : "layer-item"}
            onClick={() => onSelect(node.id)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "2px 6px",
              border: "none", background: selectedId === node.id ? "#4f7cff1a" : "transparent",
              color: "inherit", cursor: "pointer", width: "100%", textAlign: "left",
              borderRadius: 3
            }}
          >
            <span style={{ color: "#738196", fontSize: 9, minWidth: 20 }}>{node.tag}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.text}</span>
          </button>
          {node.children.length > 0 && (
            <LayerTree nodes={node.children} onSelect={onSelect} selectedId={selectedId} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
