import { Eye, EyeOff } from "lucide-react";
import type {
  BreakpointDefinition
} from "../../../../domain/responsive/responsive-model";
import type { SelectionSnapshot } from "../../../../editor-runtime/protocol";

interface BreakpointInspectorProps {
  breakpoint: BreakpointDefinition;
  selection: SelectionSnapshot;
  onPreview: (property: string, value: string) => void;
  onCommit: (property: string, value: string) => void;
  onVisibility: (visible: boolean) => void;
}

export function BreakpointInspector({
  breakpoint,
  selection,
  onPreview,
  onCommit,
  onVisibility
}: BreakpointInspectorProps): React.JSX.Element {
  const hasOverride = selection.responsiveOverrides?.includes(
    breakpoint.id
  ) ?? false;
  return (
    <section className="breakpoint-inspector">
      <div className="breakpoint-inspector-heading">
        <div>
          <strong>{breakpoint.name}断点覆盖</strong>
          <small>
            {breakpoint.direction}: {breakpoint.mediaWidth}px
          </small>
        </div>
        <span className={hasOverride ? "has-override" : ""}>
          {hasOverride ? "已有覆盖" : "继承基础样式"}
        </span>
      </div>
      <p>
        这里的修改只在当前断点生效；桌面基础样式不会被改动。
      </p>
      <div className="field-grid">
        <label>
          字号
          <input
            key={`responsive-font-${selection.nodeId}-${breakpoint.id}`}
            type="number"
            min="6"
            max="240"
            defaultValue={parseFloat(selection.fontSize) || 16}
            onInput={(event) => onPreview(
              "font-size",
              event.currentTarget.value
                ? `${event.currentTarget.value}px`
                : ""
            )}
            onBlur={(event) => onCommit(
              "font-size",
              event.currentTarget.value
                ? `${event.currentTarget.value}px`
                : ""
            )}
          />
        </label>
        <label>
          圆角
          <input
            key={`responsive-radius-${selection.nodeId}-${breakpoint.id}`}
            type="number"
            min="0"
            defaultValue={parseFloat(selection.borderRadius ?? "0") || 0}
            onInput={(event) => onPreview(
              "border-radius",
              event.currentTarget.value
                ? `${event.currentTarget.value}px`
                : ""
            )}
            onBlur={(event) => onCommit(
              "border-radius",
              event.currentTarget.value
                ? `${event.currentTarget.value}px`
                : ""
            )}
          />
        </label>
      </div>
      <label>
        背景色
        <div className="color-control">
          <input
            type="color"
            defaultValue={selection.backgroundColor || "#ffffff"}
            onInput={(event) =>
              onPreview("background-color", event.currentTarget.value)}
            onChange={(event) =>
              onCommit("background-color", event.currentTarget.value)}
          />
          <button
            type="button"
            onClick={() => onCommit("background-color", "")}
          >
            清除覆盖
          </button>
        </div>
      </label>
      <div className="breakpoint-visibility">
        <button onClick={() => onVisibility(true)}>
          <Eye size={14} /> 当前断点显示
        </button>
        <button onClick={() => onVisibility(false)}>
          <EyeOff size={14} /> 当前断点隐藏
        </button>
      </div>
    </section>
  );
}

