import {
  Monitor,
  RotateCw,
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
  onViewportChange: (width: number, height: number) => void;
  onRotate: () => void;
  onAudit: () => void;
}

export function ResponsiveToolbar({
  settings,
  viewport,
  auditBusy,
  onSelect,
  onViewportChange,
  onRotate,
  onAudit
}: ResponsiveToolbarProps): React.JSX.Element {
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
          value={viewport.width}
          onChange={(event) =>
            onViewportChange(Number(event.target.value), viewport.height)}
          aria-label="画布宽度"
        />
        <span>×</span>
        <input
          type="number"
          min="240"
          max="7680"
          value={viewport.height}
          onChange={(event) =>
            onViewportChange(viewport.width, Number(event.target.value))}
          aria-label="画布高度"
        />
      </div>
      <button
        className="canvas-tool-button"
        onClick={onRotate}
        title="切换横屏/竖屏；不会改变媒体断点"
        aria-label="切换横竖屏"
      >
        <RotateCw size={14} />
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

