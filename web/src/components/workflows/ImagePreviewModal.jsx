import { XCircle } from "lucide-react";

export function ImagePreviewModal({ image, onClose }) {
  if (!image) return null;
  return (
    <div className="image-preview-backdrop" onClick={onClose} role="presentation">
      <div className="image-preview-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭图片预览">
          <XCircle size={18} />
        </button>
        <img src={image.url} alt="图片预览" />
      </div>
    </div>
  );
}
