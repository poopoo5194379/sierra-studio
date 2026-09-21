import {
  useEffect,
  useRef,
  useState,
  type RefObject
} from "react";

interface CanvasViewportProps {
  documentUrl: string;
  projectId: string;
  reloadKey: number;
  viewportWidth: number;
  canvasWidth: number;
  canvasHeight: number;
  allowUpscale: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  runtimeState: "loading" | "ready" | "error";
  onReload: () => void;
}

export function CanvasViewport({
  documentUrl,
  projectId,
  reloadKey,
  viewportWidth,
  canvasWidth,
  canvasHeight,
  allowUpscale,
  iframeRef,
  runtimeState,
  onReload
}: CanvasViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const canvasScale = canvasWidth / viewportWidth;
  const viewportHeight = Math.max(
    240,
    Math.round(canvasHeight / canvasScale)
  );
  const frameScale = canvasScale * fitScale;
  // Tracking for undo/redo navigations without destroying iframe
  const prevReloadRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = (): void => {
      const availableWidth = Math.max(320, host.clientWidth - 56);
      const nextScale = availableWidth / canvasWidth;
      setFitScale(allowUpscale ? nextScale : Math.min(1, nextScale));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [allowUpscale, canvasWidth]);

  // When reloadKey changes after initial mount, navigate the iframe's src
  // instead of destroying it (avoids white flash on undo/redo).
  useEffect(() => {
    if (prevReloadRef.current === null) {
      prevReloadRef.current = reloadKey;
      return;
    }
    if (prevReloadRef.current !== reloadKey) {
      prevReloadRef.current = reloadKey;
      const iframe = iframeRef.current;
      if (iframe) {
        iframe.src = `${documentUrl}?reload=${reloadKey}`;
      }
    }
  }, [reloadKey, documentUrl, iframeRef]);

  return (
    <div className="canvas-viewport-host" ref={hostRef}>
      <div className={`runtime-state ${runtimeState}`}>
        <span />
        {runtimeState === "ready"
          ? "编辑器已连接"
          : runtimeState === "loading"
            ? "正在连接编辑器…"
            : "编辑器未启动"}
        {runtimeState === "error" && (
          <button onClick={onReload}>重新加载</button>
        )}
      </div>
      <div
        className="canvas-scale-stage"
        style={{
          width: `${canvasWidth * fitScale}px`,
          height: `${canvasHeight * fitScale}px`
        }}
      >
        <div
          className="canvas-frame"
          style={{
            width: `${viewportWidth}px`,
            height: `${viewportHeight}px`,
            transform: `scale(${frameScale})`
          }}
        >
          <iframe
            key={projectId}
            ref={iframeRef}
            title="HTML editing canvas"
            sandbox="allow-scripts allow-same-origin"
            src={`${documentUrl}?reload=${reloadKey}`}
          />
        </div>
      </div>
      <div className="viewport-badge">
        显示画布 {canvasWidth} × {canvasHeight}
        <span>响应式宽度 {viewportWidth} · {Math.round(frameScale * 100)}%</span>
      </div>
    </div>
  );
}
