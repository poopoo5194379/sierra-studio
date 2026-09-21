import {
  useEffect,
  useState
} from "react";
import {
  Monitor,
  ScanSearch,
  Smartphone,
  Tablet
} from "lucide-react";
import type {
  BreakpointDefinition,
  ResponsiveProjectSettings
} from "../../../../domain/responsive/responsive-model";

const ICONS = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone
} as const;

interface ResponsiveToolbarProps {
  settings: ResponsiveProjectSettings;
  viewport: { width: number; height: number };
  auditBusy: boolean;
  onSelect: (breakpoint: BreakpointDefinition) => void;
  onCanvasWidthChange: (width: number) => void;
  onCanvasHeightChange: (height: number) => void;
  onRotate: () => void;
  onAudit: () => void;
}

export function ResponsiveToolbar({
  settings,
  viewport,
  auditBusy,
  onSelect,
  onCanvasWidthChange,
  onCanvasHeightChange,
  onRotate,
  onAudit
}: ResponsiveToolbarProps): React.JSX.Element {
  const [widthDraft, setWidthDraft] = useState(String(viewport.width));
  const [heightDraft, setHeightDraft] = useState(String(viewport.height));

  useEffect(() => setWidthDraft(String(viewport.width)), [viewport.width]);
  useEffect(() => setHeightDraft(String(viewport.height)), [viewport.height]);

  const commitWidth = (): void => {
    const value = Number(widthDraft);
    if (Number.isFinite(value) && value >= 240 && value <= 7680) {
      onCanvasWidthChange(Math.round(value));
    } else {
      setWidthDraft(String(viewport.width));
    }
  };

  const commitHeight = (): void => {
    const value = Number(heightDraft);
    if (Number.isFinite(value) && value >= 240 && value <= 7680) {
      onCanvasHeightChange(Math.round(value));
    } else {
      setHeightDraft(String(viewport.height));
    }
  };

  return (
    <>
      <div className="viewport-presets" aria-label="响应式断点">
        {settings.breakpoints.map((breakpoint) => {
          const Icon = ICONS[
            breakpoint.id as keyof typeof ICONS
          ] ?? Monitor;
          return (
            <button
              key={breakpoint.id}
              className={
                settings.activeBreakpointId === breakpoint.id ? "active" : ""
              }
              onClick={() => onSelect(breakpoint)}
              title={`${breakpoint.name} ${breakpoint.width} × ${breakpoint.height}${
                breakpoint.mediaWidth
                  ? ` · ${breakpoint.direction}: ${breakpoint.mediaWidth}px`
                  : " · 基础样式"
              }`}
              aria-label={`${breakpoint.name}断点`}
            >
              <Icon size={15} />
              <span>{breakpoint.name}</span>
            </button>
          );
        })}
      </div>
      <div className="canvas-size">
        <input
          type="number"
          min="240"
          max="7680"
          value={widthDraft}
          onChange={(event) => setWidthDraft(event.target.value)}
          onBlur={commitWidth}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setWidthDraft(String(viewport.width));
              event.currentTarget.blur();
            }
          }}
          aria-label="画布宽度"
          title="输入后按回车；改变显示宽度，不切换响应式断点"
        />
        <span>×</span>
        <input
          type="number"
          min="240"
          max="7680"
          value={heightDraft}
          onChange={(event) => setHeightDraft(event.target.value)}
          onBlur={commitHeight}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setHeightDraft(String(viewport.height));
              event.currentTarget.blur();
            }
          }}
          aria-label="画布高度"
          title="输入后按回车；改变可见页面高度，适合长页下拉浏览"
        />
      </div>
      <button
        className="canvas-tool-button"
        onClick={onRotate}
        title="切换横屏/竖屏；画布会完整匹配新尺寸"
        aria-label="切换横竖屏"
      >
        切换横屏/竖屏
      </button>
      <button
        className="canvas-tool-button audit"
        onClick={onAudit}
        disabled={auditBusy}
        title="检查横向溢出、截断、图片超界和过小按钮"
      >
        <ScanSearch size={14} />
        {auditBusy ? "检查中…" : "响应式检查"}
      </button>
    </>
  );
}
