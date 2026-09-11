export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Camera Monitor System">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <rect x="5" y="9" width="22" height="16" rx="5" />
          <circle cx="16" cy="17" r="5" />
          <path d="M10 9l2-3h8l2 3M3 15h2M27 15h2" />
          <circle className="brand__signal" cx="24" cy="12" r="2" />
        </svg>
      </span>
      {!compact && (
        <span className="brand__copy">
          <strong>Camera Monitor</strong>
          <small>CAMMON SYSTEM</small>
        </span>
      )}
    </div>
  );
}
