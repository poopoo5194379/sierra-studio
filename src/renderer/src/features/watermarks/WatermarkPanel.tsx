import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  RefreshCw,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import {
  createWatermarkItem,
  type LegacyWatermarkCandidate,
  type WatermarkAnchor,
  type WatermarkItem,
  type WatermarkSettings
} from "../../../../domain/watermarks/watermark-model";

const ANCHORS: Array<{
  id: WatermarkAnchor;
  label: string;
}> = [
  { id: "top-left", label: "左上" },
  { id: "top-center", label: "上中" },
  { id: "top-right", label: "右上" },
  { id: "middle-left", label: "左中" },
  { id: "center", label: "居中" },
  { id: "middle-right", label: "右中" },
  { id: "bottom-left", label: "左下" },
  { id: "bottom-center", label: "下中" },
  { id: "bottom-right", label: "右下" }
];

function formatPages(pages: number[]): string {
  return pages.join(",");
}

function parsePages(value: string): number[] {
  const pages = new Set<number>();
  for (const part of value.split(/[，,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (
        let page = Math.min(start, end);
        page <= Math.max(start, end) && page <= 999;
        page += 1
      ) pages.add(page);
      continue;
    }
    const page = Number(part);
    if (Number.isInteger(page) && page > 0) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

interface WatermarkPanelProps {
  settings: WatermarkSettings;
  candidates: LegacyWatermarkCandidate[];
  focusRequest: { id: string; sequence: number } | null;
  disabled: boolean;
  onChooseImage: () => Promise<{
    source: string;
    aspectRatio: number;
  } | null>;
  onPreview: (settings: WatermarkSettings) => void;
  onApply: (settings: WatermarkSettings) => void;
  onCancelPreview: () => void;
  onRefreshCandidates: () => void;
}

export function WatermarkPanel({
  settings,
  candidates,
  focusRequest,
  disabled,
  onChooseImage,
  onPreview,
  onApply,
  onCancelPreview,
  onRefreshCandidates
}: WatermarkPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<WatermarkSettings>(
    structuredClone(settings)
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    settings.items[0]?.id ?? null
  );

  useEffect(() => {
    setDraft(structuredClone(settings));
    setSelectedId((current) =>
      settings.items.some((item) => item.id === current)
        ? current
        : settings.items[0]?.id ?? null
    );
    return onCancelPreview;
  }, [settings, onCancelPreview]);

  useEffect(() => {
    if (
      focusRequest
      && draft.items.some((item) => item.id === focusRequest.id)
    ) {
      setSelectedId(focusRequest.id);
    }
  }, [focusRequest, draft.items]);

  const selected = useMemo(
    () => draft.items.find((item) => item.id === selectedId) ?? null,
    [draft.items, selectedId]
  );

  const change = (next: WatermarkSettings): void => {
    setDraft(next);
    onPreview(next);
  };

  const patchSelected = (patch: Partial<WatermarkItem>): void => {
    if (!selectedId) return;
    change({
      ...draft,
      items: draft.items.map((item) =>
        item.id === selectedId ? { ...item, ...patch } : item
      )
    });
  };

  const moveSelected = (dx: number, dy: number): void => {
    if (!selectedId || !selected) return;
    const horizontalSign = selected.anchor.endsWith("right") ? -1 : 1;
    const verticalSign = selected.anchor.startsWith("bottom") ? -1 : 1;
    const next = {
      ...draft,
      items: draft.items.map((item) =>
        item.id === selectedId
          ? {
            ...item,
            offsetXmm: Math.round(
              Math.max(0, item.offsetXmm + dx * horizontalSign) * 10
            ) / 10,
            offsetYmm: Math.round(
              Math.max(0, item.offsetYmm + dy * verticalSign) * 10
            ) / 10
          }
          : item
      )
    };
    setDraft(next);
    onApply(next);
  };

  const resetSelectedPosition = (): void => {
    if (!selectedId) return;
    const next = {
      ...draft,
      items: draft.items.map((item) =>
        item.id === selectedId
          ? { ...item, offsetXmm: 0, offsetYmm: 0 }
          : item
      )
    };
    setDraft(next);
    onApply(next);
  };

  const addImage = async (): Promise<void> => {
    const imported = await onChooseImage();
    if (!imported) return;
    const item = createWatermarkItem(
      imported.source,
      imported.aspectRatio,
      `图片水印 ${draft.items.length + 1}`
    );
    const next = { ...draft, items: [...draft.items, item] };
    setSelectedId(item.id);
    change(next);
  };

  const migrate = (candidate: LegacyWatermarkCandidate): void => {
    const item: WatermarkItem = {
      ...createWatermarkItem(
        candidate.source,
        candidate.aspectRatio,
        candidate.name
      ),
      anchor: candidate.anchor,
      widthMm: candidate.widthMm,
      offsetXmm: candidate.offsetXmm,
      offsetYmm: candidate.offsetYmm,
      opacity: candidate.opacity
    };
    const next = {
      ...draft,
      items: [...draft.items, item],
      suppressedSelectors: [
        ...new Set([...draft.suppressedSelectors, candidate.selector])
      ]
    };
    setSelectedId(item.id);
    change(next);
  };

  return (
    <section className="watermark-panel">
      <div className="panel-heading">
        <div>
          <h2>全局水印</h2>
          <p>统一管理所有页面的 Logo 与水印</p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onRefreshCandidates}
          disabled={disabled}
          title="重新检测现有水印"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {candidates
        .filter((candidate) =>
          !draft.suppressedSelectors.includes(candidate.selector)
        )
        .map((candidate) => (
          <div className="watermark-detection" key={candidate.selector}>
            <img src={candidate.source} alt="" />
            <div>
              <strong>发现 {candidate.count} 个重复水印</strong>
              <small>{candidate.selector} · 可转换为全局变量</small>
            </div>
            <button type="button" onClick={() => migrate(candidate)}>
              转换
            </button>
          </div>
        ))}

      <button
        className="asset-import watermark-import"
        type="button"
        onClick={() => void addImage()}
        disabled={disabled}
      >
        <span><Upload size={18} /></span>
        <div>
          <strong>添加图片水印</strong>
          <small>支持添加多个，不会按页面重复写入</small>
        </div>
      </button>

      <div className="watermark-list">
        {draft.items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === selectedId ? "active" : ""}
            onClick={() => setSelectedId(item.id)}
          >
            <img src={item.source} alt="" />
            <span>
              <strong>{item.name}</strong>
              <small>
                {ANCHORS.find((anchor) => anchor.id === item.anchor)?.label}
                {item.pages.length === 0
                  ? " · 全部页面"
                  : ` · ${item.pages.length} 页`}
              </small>
            </span>
            <i className={item.enabled ? "enabled" : ""} />
          </button>
        ))}
      </div>

      {selected ? (
        <div className="watermark-editor">
          <label>
            <span>名称</span>
            <input
              value={selected.name}
              onChange={(event) => patchSelected({
                name: event.currentTarget.value || "图片水印"
              })}
            />
          </label>

          <div className="watermark-anchor-grid" role="group" aria-label="水印位置">
            {ANCHORS.map((anchor) => (
              <button
                type="button"
                key={anchor.id}
                className={selected.anchor === anchor.id ? "active" : ""}
                onClick={() => patchSelected({ anchor: anchor.id })}
              >
                {anchor.label}
              </button>
            ))}
          </div>

          <div className="watermark-number-grid">
            <label>
              <span>宽度（mm）</span>
              <input
                type="number"
                min="2"
                max="300"
                value={selected.widthMm}
                onChange={(event) => patchSelected({
                  widthMm: Number(event.currentTarget.value) || 2
                })}
              />
            </label>
            <label>
              <span>透明度（%）</span>
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(selected.opacity * 100)}
                onChange={(event) => patchSelected({
                  opacity: Math.min(
                    1,
                    Math.max(0, Number(event.currentTarget.value) / 100)
                  )
                })}
              />
            </label>
            <label>
              <span>水平偏移</span>
              <input
                type="number"
                min="0"
                value={selected.offsetXmm}
                onChange={(event) => patchSelected({
                  offsetXmm: Math.max(
                    0,
                    Number(event.currentTarget.value) || 0
                  )
                })}
              />
            </label>
            <label>
              <span>垂直偏移</span>
              <input
                type="number"
                min="0"
                value={selected.offsetYmm}
                onChange={(event) => patchSelected({
                  offsetYmm: Math.max(
                    0,
                    Number(event.currentTarget.value) || 0
                  )
                })}
              />
            </label>
            <label>
              <span>旋转角度</span>
              <input
                type="number"
                min="-180"
                max="180"
                value={selected.rotation}
                onChange={(event) => patchSelected({
                  rotation: Number(event.currentTarget.value) || 0
                })}
              />
            </label>
          </div>

          <div className="watermark-nudge">
            <div>
              <strong>同步移动全部页面</strong>
              <small>每点一次移动 0.5 mm，并立即保存，可用 Ctrl+Z 撤销</small>
            </div>
            <div className="watermark-nudge-pad">
              <button
                type="button"
                aria-label="水印上移"
                onClick={() => moveSelected(0, -0.5)}
              >↑</button>
              <button
                type="button"
                aria-label="水印左移"
                onClick={() => moveSelected(-0.5, 0)}
              >←</button>
              <button
                type="button"
                onClick={resetSelectedPosition}
              >归位</button>
              <button
                type="button"
                aria-label="水印右移"
                onClick={() => moveSelected(0.5, 0)}
              >→</button>
              <button
                type="button"
                aria-label="水印下移"
                onClick={() => moveSelected(0, 0.5)}
              >↓</button>
            </div>
          </div>

          <label>
            <span>应用页面</span>
            <input
              value={formatPages(selected.pages)}
              placeholder="留空为全部页面；例如 1-3,5"
              onChange={(event) => patchSelected({
                pages: parsePages(event.currentTarget.value)
              })}
            />
          </label>

          <div className="watermark-toggles">
            <label>
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(event) => patchSelected({
                  enabled: event.currentTarget.checked
                })}
              />
              启用
            </label>
            <label>
              <input
                type="checkbox"
                checked={selected.repeat}
                onChange={(event) => patchSelected({
                  repeat: event.currentTarget.checked
                })}
              />
              平铺
            </label>
            <label>
              <input
                type="checkbox"
                checked={selected.screen}
                onChange={(event) => patchSelected({
                  screen: event.currentTarget.checked
                })}
              />
              画布显示
            </label>
            <label>
              <input
                type="checkbox"
                checked={selected.print}
                onChange={(event) => patchSelected({
                  print: event.currentTarget.checked
                })}
              />
              PDF/打印
            </label>
          </div>

          <div className="watermark-item-actions">
            <button
              type="button"
              onClick={() => {
                const copy = {
                  ...structuredClone(selected),
                  id: `watermark_${crypto.randomUUID()}`,
                  name: `${selected.name} 副本`
                };
                setSelectedId(copy.id);
                change({ ...draft, items: [...draft.items, copy] });
              }}
            >
              <Copy size={14} />复制
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                const items = draft.items.filter(
                  (item) => item.id !== selected.id
                );
                setSelectedId(items[0]?.id ?? null);
                change({ ...draft, items });
              }}
            >
              <Trash2 size={14} />删除
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-empty compact">
          <strong>尚未添加水印</strong>
          <p>上传图片，或转换检测到的重复 Logo。</p>
        </div>
      )}

      <div className="watermark-save-actions">
        <button
          type="button"
          onClick={() => {
            setDraft(structuredClone(settings));
            onCancelPreview();
          }}
        >
          取消预览
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onApply(draft)}
          disabled={disabled}
        >
          <Save size={14} />应用并保存
        </button>
      </div>
    </section>
  );
}
