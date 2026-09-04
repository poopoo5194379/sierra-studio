import { useEffect, useState } from "react";
import { Eye, Palette, Save, Undo2 } from "lucide-react";
import type {
  ProjectTheme,
  ThemeToken
} from "../../../../domain/theme/theme-model";

interface ThemePanelProps {
  theme: ProjectTheme;
  disabled: boolean;
  onPreview: (theme: ProjectTheme) => void;
  onApply: (theme: ProjectTheme) => void;
  onCancelPreview: () => void;
}

export function ThemePanel({
  theme,
  disabled,
  onPreview,
  onApply,
  onCancelPreview
}: ThemePanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<ProjectTheme>(() =>
    structuredClone(theme));

  useEffect(() => {
    setDraft(structuredClone(theme));
    return onCancelPreview;
  }, [theme, onCancelPreview]);

  const updateToken = (id: string, patch: Partial<ThemeToken>): void => {
    setDraft((current) => ({
      ...current,
      tokens: current.tokens.map((token) =>
        token.id === id ? { ...token, ...patch } : token)
    }));
  };

  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>品牌主题</h2>
          <p>项目级 CSS 变量与明暗模式</p>
        </div>
        <Palette size={17} />
      </div>
      <div className="theme-mode-switch" role="group" aria-label="主题模式">
        {(["light", "dark"] as const).map((mode) => (
          <button
            key={mode}
            className={draft.mode === mode ? "active" : ""}
            onClick={() => setDraft((current) => ({ ...current, mode }))}
          >
            {mode === "light" ? "浅色" : "深色"}
          </button>
        ))}
      </div>
      <label className="checkbox-field theme-base-toggle">
        <input
          type="checkbox"
          checked={draft.applyBaseStyles}
          onChange={(event) => setDraft((current) => ({
            ...current,
            applyBaseStyles: event.target.checked
          }))}
        />
        <span>
          <strong>应用基础品牌规则</strong>
          <small>影响页面背景、正文/标题字体、基础字号和按钮圆角</small>
        </span>
      </label>
      <div className="theme-token-list">
        {draft.tokens.map((token) => (
          <label key={token.id}>
            <span>
              <strong>{token.name}</strong>
              <code>{token.cssVariable}</code>
            </span>
            {token.kind === "color" ? (
              <div className="theme-color-input">
                <input
                  type="color"
                  value={
                    (draft.mode === "dark" ? token.dark : token.light)
                    ?? token.light
                  }
                  onChange={(event) => updateToken(token.id, {
                    [draft.mode === "dark" ? "dark" : "light"]:
                      event.target.value
                  })}
                />
                <input
                  value={
                    (draft.mode === "dark" ? token.dark : token.light)
                    ?? token.light
                  }
                  onChange={(event) => updateToken(token.id, {
                    [draft.mode === "dark" ? "dark" : "light"]:
                      event.target.value
                  })}
                />
              </div>
            ) : (
              <input
                value={
                  (draft.mode === "dark" ? token.dark : token.light)
                  ?? token.light
                }
                onChange={(event) => updateToken(token.id, {
                  [draft.mode === "dark" ? "dark" : "light"]:
                    event.target.value
                })}
              />
            )}
          </label>
        ))}
      </div>
      <div className="theme-actions">
        <button
          disabled={disabled}
          onClick={() => onPreview(draft)}
        >
          <Eye size={14} />预览
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            onCancelPreview();
            setDraft(structuredClone(theme));
          }}
        >
          <Undo2 size={14} />还原
        </button>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => onApply(draft)}
        >
          <Save size={14} />应用主题
        </button>
      </div>
      <div className="panel-note">
        <Palette size={16} />
        <p>
          主题会写入导出 HTML；关闭“基础品牌规则”时只定义变量，不会擅自覆盖原页面。
        </p>
      </div>
    </>
  );
}

