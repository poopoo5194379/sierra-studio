import { useState } from "react";
import {
  Component,
  CopyPlus,
  Link2Off,
  RotateCcw
} from "lucide-react";
import type {
  ComponentSelection
} from "../../../../domain/components/component-model";

interface ReusableComponentPanelProps {
  component: ComponentSelection | undefined;
  onCreate: (name: string) => void;
  onDuplicate: () => void;
  onDetach: () => void;
  onResetField: () => void;
}

export function ReusableComponentPanel({
  component,
  onCreate,
  onDuplicate,
  onDetach,
  onResetField
}: ReusableComponentPanelProps): React.JSX.Element {
  const [name, setName] = useState("新组件");
  if (!component) {
    return (
      <section className="reusable-component-panel">
        <div className="component-panel-heading">
          <Component size={15} />
          <div>
            <strong>可复用组件</strong>
            <small>创建主组件并自动识别文字、图片和链接字段</small>
          </div>
        </div>
        <div className="component-create-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="组件名称"
          />
          <button onClick={() => onCreate(name)}>创建</button>
        </div>
      </section>
    );
  }

  const currentFieldOverridden = component.fieldKey
    ? component.overrides.includes(component.fieldKey)
      || component.conflicts.includes(component.fieldKey)
    : false;
  return (
    <section className="reusable-component-panel active">
      <div className="component-panel-heading">
        <Component size={15} />
        <div>
          <strong>{component.name}</strong>
          <small>
            {component.role === "master" ? "主组件" : "实例"}
            {" · "}v{component.version}
            {" · "}{component.instanceCount} 个实例
          </small>
        </div>
        <span>{component.role === "master" ? "MASTER" : "INSTANCE"}</span>
      </div>
      {component.fieldKey && (
        <div className="component-field-state">
          <code>{component.fieldKey}</code>
          <span>
            {component.overrides.includes(component.fieldKey)
              ? "实例覆盖"
              : component.conflicts.includes(component.fieldKey)
                ? "主组件更新冲突"
                : "跟随主组件"}
          </span>
        </div>
      )}
      <div className="component-actions">
        <button onClick={onDuplicate}>
          <CopyPlus size={14} />创建实例
        </button>
        {component.role === "instance" && currentFieldOverridden && (
          <button onClick={onResetField}>
            <RotateCcw size={14} />恢复字段
          </button>
        )}
        <button onClick={onDetach}>
          <Link2Off size={14} />分离实例
        </button>
      </div>
      {component.conflicts.length > 0 && (
        <p className="component-conflict">
          {component.conflicts.length} 个字段保留了实例内容，需要手动确认。
        </p>
      )}
    </section>
  );
}
