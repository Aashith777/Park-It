export default function StarRating({ value = 0, onChange, size = 20, readOnly = false }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex gap-0.5">
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange && onChange(star)}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
          style={{ fontSize: size, lineHeight: 1 }}
        >
          <span className={star <= value ? "text-signal" : "text-black/15"}>★</span>
        </button>
      ))}
    </div>
  );
}
