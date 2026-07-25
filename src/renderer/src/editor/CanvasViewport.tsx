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
  viewportHeight: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  runtimeState: "loading" | "ready" | "error";
  onReload: () => void;
}

export function CanvasViewport({
  documentUrl,
  projectId,
  reloadKey,
  viewportWidth,
  viewportHeight,
  iframeRef,
  runtimeState,
  onReload
}: CanvasViewportProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Tracking for undo/redo navigations without destroying iframe
  const prevReloadRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = (): void => {
      const availableWidth = Math.max(320, host.clientWidth - 56);
      setScale(Math.min(1, availableWidth / viewportWidth));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [viewportWidth]);

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
          width: `${viewportWidth * scale}px`,
          height: `${viewportHeight * scale}px`
        }}
      >
        <div
          className="canvas-frame"
          style={{
            width: `${viewportWidth}px`,
            height: `${viewportHeight}px`,
            transform: `scale(${scale})`
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
        浏览器画布 {viewportWidth} × {viewportHeight}
        <span>{Math.round(scale * 100)}%</span>
      </div>
    </div>
  );
}
