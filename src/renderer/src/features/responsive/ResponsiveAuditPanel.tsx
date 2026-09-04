import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type {
  ResponsiveAuditReport
} from "../../../../domain/responsive/responsive-model";

interface ResponsiveAuditPanelProps {
  report: ResponsiveAuditReport;
  importedMediaQueries: string[];
  onLocate: (nodeId: string) => void;
  onClose: () => void;
}

export function ResponsiveAuditPanel({
  report,
  importedMediaQueries,
  onLocate,
  onClose
}: ResponsiveAuditPanelProps): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="responsive-audit-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">响应式检查</span>
            <h2>{report.viewportWidth} × {report.viewportHeight}</h2>
            <p>
              已检查 {report.scannedElements.toLocaleString()} 个元素
            </p>
          </div>
          <button onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        {report.issues.length === 0 ? (
          <div className="audit-empty">
            <CheckCircle2 size={30} />
            <strong>当前尺寸未发现明显问题</strong>
            <p>仍建议在真实设备和导出结果中进行最终确认。</p>
          </div>
        ) : (
          <div className="audit-issues">
            {report.issues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => onLocate(issue.nodeId)}
              >
                <AlertTriangle size={16} />
                <span>
                  <strong>{issue.message}</strong>
                  <small>{issue.kind} · {issue.nodeId}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <footer>
          <strong>页面已有媒体规则</strong>
          {importedMediaQueries.length > 0
            ? importedMediaQueries.map((query) => (
              <code key={query}>{query}</code>
            ))
            : <span>未检测到已有 @media 规则</span>}
        </footer>
      </section>
    </div>
  );
}

