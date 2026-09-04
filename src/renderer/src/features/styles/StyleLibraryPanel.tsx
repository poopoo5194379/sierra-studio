import { useMemo, useState } from "react";
import { RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { BUILTIN_STYLE_PRESETS } from "../../../../domain/styles/builtin-style-presets";
import {
  type StylePreset,
  type StylePresetDeclaration,
  type StylePresetSource,
  type StylePresetTarget
} from "../../../../domain/styles/style-preset";

type ApplyMode = "merge" | "replace";
type SourceFilter = "all" | StylePresetSource;

interface StyleLibraryPanelProps {
  target: StylePresetTarget;
  currentDeclarations: StylePresetDeclaration[];
  documentPresets: StylePreset[];
  userPresets: StylePreset[];
  onRequestDocumentPresets: () => void;
  onPreview: (declarations: StylePresetDeclaration[]) => void;
  onCancelPreview: () => void;
  onApply: (declarations: StylePresetDeclaration[]) => void;
  onSaveUserPreset: (name: string) => void;
  onDeleteUserPreset: (id: string) => void;
}

const SOURCE_OPTIONS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "builtin", label: "内置" },
  { id: "document", label: "当前文档" },
  { id: "user", label: "我的样式" }
];

const STYLE_PRESET_PROPERTIES: Record<
  StylePresetTarget,
  readonly string[]
> = {
  text: [
    "color", "font-family", "font-size", "font-weight", "font-style",
    "line-height", "letter-spacing", "text-align", "text-transform",
    "text-decoration", "background-color", "border-left", "border-radius",
    "padding"
  ],
  surface: [
    "color", "background-color", "background-image", "border",
    "border-radius", "box-shadow", "padding", "opacity"
  ],
  image: [
    "background-color", "border", "border-radius", "box-shadow",
    "object-fit", "filter", "opacity"
  ],
  button: [
    "color", "background-color", "background-image", "font-family",
    "font-size", "font-weight", "letter-spacing", "text-transform",
    "border", "border-radius", "box-shadow", "padding"
  ],
  table: [
    "color", "background-color", "font-family", "font-size", "font-weight",
    "text-align", "border", "border-radius", "box-shadow", "padding"
  ]
};

function declarationsForMode(
  target: StylePresetTarget,
  preset: StylePreset,
  mode: ApplyMode
): StylePresetDeclaration[] {
  if (mode === "merge") return preset.declarations;
  const values = new Map(
    preset.declarations.map((item) => [item.property, item])
  );
  return STYLE_PRESET_PROPERTIES[target].map((property) =>
    values.get(property) ?? { property, value: "", priority: "" }
  );
}

function previewStyle(
  declarations: StylePresetDeclaration[]
): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const { property, value } of declarations) {
    const camelProperty = property.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase()
    );
    style[camelProperty] = value;
  }
  return style as React.CSSProperties;
}

function StylePreview({
  preset
}: {
  preset: StylePreset;
}): React.JSX.Element {
  const style = previewStyle(preset.declarations);
  if (preset.target === "image") {
    return (
      <div className="style-preset-stage image">
        <div className="style-preview-image" style={style}>
          <span>IMAGE</span>
        </div>
      </div>
    );
  }
  if (preset.target === "surface" || preset.target === "table") {
    return (
      <div className="style-preset-stage">
        <div className="style-preview-surface" style={style}>
          <strong>{preset.target === "table" ? "数据表格" : "核心结论"}</strong>
          <span>样式预览内容</span>
        </div>
      </div>
    );
  }
  return (
    <div className="style-preset-stage">
      <div
        className={`style-preview-${preset.target}`}
        style={style}
      >
        {preset.sampleText
          || (preset.target === "button" ? "查看详情" : "标题样式")}
      </div>
    </div>
  );
}

export function StyleLibraryPanel({
  target,
  currentDeclarations,
  documentPresets,
  userPresets,
  onRequestDocumentPresets,
  onPreview,
  onCancelPreview,
  onApply,
  onSaveUserPreset,
  onDeleteUserPreset
}: StyleLibraryPanelProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [mode, setMode] = useState<ApplyMode>("merge");
  const [saveName, setSaveName] = useState("");
  const presets = useMemo(() => {
    const combined = [
      ...BUILTIN_STYLE_PRESETS,
      ...documentPresets,
      ...userPresets
    ];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return combined.filter((preset) =>
      preset.target === target
      && (source === "all" || preset.source === source)
      && (
        !normalizedQuery
        || `${preset.name} ${preset.category}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    );
  }, [documentPresets, query, source, target, userPresets]);

  return (
    <section className="style-library">
      <div className="style-library-heading">
        <div>
          <strong>样式库</strong>
          <small>仅显示适用于当前元素的样式</small>
        </div>
        <button
          type="button"
          title="重新提取当前文档样式"
          aria-label="重新提取当前文档样式"
          onClick={onRequestDocumentPresets}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="style-library-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索样式"
        />
      </div>

      <div className="style-source-tabs">
        {SOURCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={source === option.id ? "active" : ""}
            onClick={() => setSource(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="style-apply-mode">
        <span>应用方式</span>
        <button
          type="button"
          className={mode === "merge" ? "active" : ""}
          onClick={() => setMode("merge")}
          title="只覆盖样式预设中包含的属性"
        >
          合并
        </button>
        <button
          type="button"
          className={mode === "replace" ? "active" : ""}
          onClick={() => setMode("replace")}
          title="先清理当前类别的可控样式，再完整套用"
        >
          替换
        </button>
      </div>

      <div className="style-preset-list">
        {presets.length > 0 ? presets.map((preset) => {
          const declarations = declarationsForMode(target, preset, mode);
          return (
            <article
              key={preset.id}
              className="style-preset-card"
              onMouseEnter={() => onPreview(declarations)}
              onMouseLeave={onCancelPreview}
              onClick={() => onApply(declarations)}
            >
              <StylePreview preset={preset} />
              <div className="style-preset-meta">
                <span>
                  <strong>{preset.name}</strong>
                  <small>
                    {preset.category}
                    {preset.usageCount && preset.usageCount > 1
                      ? ` · ${preset.usageCount} 处`
                      : ""}
                  </small>
                </span>
                {preset.source === "user" && (
                  <button
                    type="button"
                    title="删除我的样式"
                    aria-label={`删除 ${preset.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteUserPreset(preset.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          );
        }) : (
          <div className="style-library-empty">
            当前分类下没有匹配样式
          </div>
        )}
      </div>

      <div className="style-save-current">
        <label htmlFor="style-preset-name">保存当前元素样式</label>
        <div>
          <input
            id="style-preset-name"
            value={saveName}
            onChange={(event) => setSaveName(event.currentTarget.value)}
            placeholder="例如：蓝色数据卡"
          />
          <button
            type="button"
            title="保存到我的样式"
            disabled={
              saveName.trim().length === 0
              || currentDeclarations.length === 0
            }
            onClick={() => {
              onSaveUserPreset(saveName.trim());
              setSaveName("");
              setSource("user");
            }}
          >
            <Save size={14} />
            保存
          </button>
        </div>
      </div>
    </section>
  );
}
