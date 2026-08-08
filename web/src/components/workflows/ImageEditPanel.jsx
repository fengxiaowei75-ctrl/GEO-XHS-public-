import { SelectControl } from "../form/SelectControl";

const imageEditCountOptions = [
  { value: "1", label: "改图 1 张" },
  { value: "2", label: "改图 + 新图 2 张" },
];

export function ImageEditPanel({
  title,
  instruction,
  onInstructionChange,
  imageCount,
  onImageCountChange,
  onCancel,
  onSubmit,
  editing,
  placeholder,
}) {
  return (
    <form className="image-edit-panel" onSubmit={onSubmit}>
      <div className="image-edit-head">
        <strong>{title}</strong>
        <button className="copy-button" type="button" onClick={onCancel} disabled={editing}>
          取消
        </button>
      </div>
      <textarea value={instruction} onChange={(event) => onInstructionChange(event.target.value)} placeholder={placeholder} rows={4} />
      <div className="image-edit-options">
        <SelectControl value={imageCount} onChange={onImageCountChange} label="输出" options={imageEditCountOptions} />
      </div>
      <div className="image-edit-actions">
        <button className="primary-button" type="submit" disabled={editing}>
          {editing ? "改图中" : "确认改图"}
        </button>
      </div>
    </form>
  );
}
