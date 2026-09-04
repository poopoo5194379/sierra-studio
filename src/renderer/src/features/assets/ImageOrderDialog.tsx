import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";

export interface OrderedBatchImage {
  id: string;
  imageSource: string;
  originalName: string;
}

interface ImageOrderDialogProps {
  images: OrderedBatchImage[];
  slotCount: number;
  onChange: (images: OrderedBatchImage[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReselect: () => void;
}

function moveImage(
  images: OrderedBatchImage[],
  fromIndex: number,
  toIndex: number
): OrderedBatchImage[] {
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= images.length
    || toIndex >= images.length
    || fromIndex === toIndex
  ) return images;
  const next = [...images];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return images;
  next.splice(toIndex, 0, moved);
  return next;
}

export function ImageOrderDialog({
  images,
  slotCount,
  onChange,
  onCancel,
  onConfirm,
  onReselect
}: ImageOrderDialogProps): React.JSX.Element {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const mappedCount = Math.min(images.length, slotCount);
  const extraImageCount = Math.max(0, images.length - slotCount);
  const emptySlotCount = Math.max(0, slotCount - images.length);

  return (
    <div className="modal-backdrop image-order-backdrop" role="presentation">
      <section
        className="pdf-dialog image-order-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-order-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="image-order-title">确认图片嵌入顺序</h2>
            <p>
              拖动缩略图调整顺序；第 N 张图片将嵌入绿色编号 N 的图片槽。
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onCancel}
            title="关闭"
            aria-label="关闭图片顺序确认"
          >
            <X size={18} />
          </button>
        </div>

        <div className="image-order-summary">
          <strong>{images.length} 张图片</strong>
          <span>→</span>
          <strong>{slotCount} 个已选槽位</strong>
          <small>本次将嵌入 {mappedCount} 张</small>
        </div>

        {(extraImageCount > 0 || emptySlotCount > 0) && (
          <div className="image-order-warning">
            {extraImageCount > 0
              ? `有 ${extraImageCount} 张图片没有对应槽位，确认时会跳过。`
              : `图片比槽位少 ${emptySlotCount} 张，剩余槽位将保持原样。`}
          </div>
        )}

        <div className="image-order-toolbar">
          <button
            type="button"
            onClick={() => onChange(
              [...images].sort((left, right) =>
                left.originalName.localeCompare(
                  right.originalName,
                  "zh-CN",
                  { numeric: true, sensitivity: "base" }
                )
              )
            )}
          >
            按文件名排序
          </button>
          <button
            type="button"
            onClick={() => onChange([...images].reverse())}
          >
            反向排列
          </button>
          <button type="button" onClick={onReselect}>
            <RefreshCw size={13} />
            重新选择文件
          </button>
        </div>

        <div className="image-order-grid">
          {images.map((image, index) => {
            const hasSlot = index < slotCount;
            return (
              <article
                key={image.id}
                className={`image-order-card${draggedId === image.id ? " dragging" : ""}${hasSlot ? "" : " unmatched"}`}
                draggable
                onDragStart={(event) => {
                  setDraggedId(image.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", image.id);
                }}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId =
                    event.dataTransfer.getData("text/plain") || draggedId;
                  const fromIndex = images.findIndex(
                    (candidate) => candidate.id === sourceId
                  );
                  onChange(moveImage(images, fromIndex, index));
                  setDraggedId(null);
                }}
              >
                <div className="image-order-preview">
                  <img src={image.imageSource} alt="" />
                  <span className={hasSlot ? "" : "unmatched"}>
                    {hasSlot ? index + 1 : "—"}
                  </span>
                  <GripVertical
                    className="image-order-grip"
                    size={18}
                    aria-hidden="true"
                  />
                </div>
                <div className="image-order-card-meta">
                  <strong title={image.originalName}>
                    {image.originalName}
                  </strong>
                  <small>
                    {hasSlot
                      ? `图片 ${index + 1} → 槽位 ${index + 1}`
                      : "无对应槽位，将跳过"}
                  </small>
                </div>
                <div className="image-order-card-actions">
                  <button
                    type="button"
                    title="上移"
                    aria-label={`上移 ${image.originalName}`}
                    disabled={index === 0}
                    onClick={() => onChange(
                      moveImage(images, index, index - 1)
                    )}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    title="下移"
                    aria-label={`下移 ${image.originalName}`}
                    disabled={index === images.length - 1}
                    onClick={() => onChange(
                      moveImage(images, index, index + 1)
                    )}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title="移除"
                    aria-label={`移除 ${image.originalName}`}
                    onClick={() => onChange(
                      images.filter((candidate) => candidate.id !== image.id)
                    )}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="primary"
            onClick={onConfirm}
            disabled={images.length === 0 || slotCount === 0}
          >
            按当前顺序嵌入 {mappedCount} 张图片
          </button>
        </div>
      </section>
    </div>
  );
}
