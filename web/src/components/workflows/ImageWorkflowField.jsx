export function ImageWorkflowField({ label, value, onChange, multiline = true, placeholder = "", rows = 4 }) {
  return (
    <label className="image-workflow-field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}
