import { useEffect, useState } from "react";
import {
  FileSearch,
  Image,
  Link2,
  ListTree,
  RefreshCw,
  Type
} from "lucide-react";
import type {
  DocumentElementFilter,
  DocumentNavigationResult
} from "../../../../domain/navigation/document-navigation";
import type { LayerNode } from "../../../../editor-runtime/protocol";
import { LayerTree } from "../../editor/LayerTree";

interface DocumentNavigatorPanelProps {
  navigation: DocumentNavigationResult | null;
  layers: LayerNode[];
  selectedId: string | null;
  onSearch: (query: string, filter: DocumentElementFilter) => void;
  onLocate: (nodeId: string) => void;
  onRequestLayers: () => void;
}

const FILTERS: Array<{
  id: DocumentElementFilter;
  label: string;
  icon: typeof FileSearch;
}> = [
  { id: "all", label: "全部", icon: FileSearch },
  { id: "text", label: "文字", icon: Type },
  { id: "image", label: "图片", icon: Image },
  { id: "chart", label: "图表", icon: ListTree },
  { id: "link", label: "链接", icon: Link2 }
];

export function DocumentNavigatorPanel({
  navigation,
  layers,
  selectedId,
  onSearch,
  onLocate,
  onRequestLayers
}: DocumentNavigatorPanelProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentElementFilter>("all");
  const [showTree, setShowTree] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(query, filter), 140);
    return () => window.clearTimeout(timer);
  }, [filter, onSearch, query]);

  useEffect(() => {
    onRequestLayers();
  }, [onRequestLayers]);

  const showResults = query.trim().length > 0 || filter !== "all";
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>文档导航</h2>
          <p>搜索、标题大纲与图层定位</p>
        </div>
        <button
          className="icon-control"
          onClick={() => onSearch(query, filter)}
          title="刷新索引"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="document-search">
        <FileSearch size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文字、标签、class、ID"
        />
      </div>
      <div className="document-filters">
        {FILTERS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={filter === id ? "active" : ""}
            onClick={() => setFilter(id)}
            title={label}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {navigation && (
        <div className="document-index-status">
          已索引 {navigation.totalIndexed.toLocaleString()} 个元素
          {navigation.truncated && " · 已达到 20,000 个上限"}
        </div>
      )}
      {showResults ? (
        <div className="document-search-results">
          {navigation?.results.length ? navigation.results.map((result) => (
            <button
              key={result.nodeId}
              className={selectedId === result.nodeId ? "active" : ""}
              onClick={() => onLocate(result.nodeId)}
            >
              <code>{result.tag}</code>
              <span>
                <strong>{result.text || "无文字内容"}</strong>
                <small>{result.className || result.nodeId}</small>
              </span>
            </button>
          )) : (
            <div className="panel-empty compact">
              <FileSearch size={20} />
              <p>没有匹配的元素</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="section-label">标题大纲</div>
          <div className="document-outline">
            {navigation?.outline.length ? navigation.outline.map((item) => (
              <button
                key={item.nodeId}
                className={selectedId === item.nodeId ? "active" : ""}
                style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }}
                onClick={() => onLocate(item.nodeId)}
              >
                <code>H{item.level}</code>
                <span>{item.text}</span>
              </button>
            )) : (
              <p>页面中没有标题元素</p>
            )}
          </div>
          <button
            className="tree-toggle"
            onClick={() => {
              const next = !showTree;
              setShowTree(next);
              if (next) onRequestLayers();
            }}
          >
            <ListTree size={14} />
            {showTree ? "收起图层结构" : "展开图层结构"}
          </button>
          {showTree && (
            <div className="limited-layer-tree">
              <LayerTree
                nodes={layers}
                selectedId={selectedId}
                onSelect={onLocate}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
