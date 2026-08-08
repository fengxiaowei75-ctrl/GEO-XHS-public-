export function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="segmented-control" style={{ "--segment-count": options.length }}>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
