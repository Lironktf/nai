function formatExpiryTime(expiresAt) {
  if (!expiresAt) return null;
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Status expressed as text label with inverted badge for verified, outlined otherwise
function StatusBadge({ status }) {
  const filled = status === "verified";
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "2px 5px",
        border: "1px solid #000",
        background: filled ? "#000" : "#fff",
        color: filled ? "#fff" : "#000",
      }}
    >
      {status}
    </span>
  );
}

function needsVerification(status) {
  return ["pending", "unlinked", "expired", "failed"].includes(status);
}

export default function ParticipantRow({ participant, onReverify }) {
  const showVerifyNow = needsVerification(participant.status);
  const sourceLabel = formatVerificationSource(participant.verificationSource);

  return (
    <div style={s.row}>
      <div style={s.info}>
        <div style={s.name}>{participant.identityLabel || "Unknown"}</div>
        <div style={s.meta}>
          <StatusBadge status={participant.status} />
          {!showVerifyNow && sourceLabel ? (
            <span style={s.source}>{sourceLabel}</span>
          ) : null}
          {!showVerifyNow && participant.verificationExpiresAt && (
            <span style={s.expiry}>
              Expires {formatExpiryTime(participant.verificationExpiresAt)}
            </span>
          )}
          {participant.failureReason && (
            <span style={s.failure}>{participant.failureReason}</span>
          )}
        </div>
      </div>
      {showVerifyNow ? (
        <button
          type="button"
          style={s.verifyButton}
          onClick={() => onReverify?.(participant)}
        >
          VERIFY NOW on NAI
        </button>
      ) : null}
    </div>
  );
}

function formatVerificationSource(value) {
  if (!value) return null;
  if (value === "extension") return "extension";
  if (value === "phone") return "phone";
  if (value === "site") return "site";
  return value;
}

const s = {
  row: {
    display: "flex",
    gap: "0.5rem",
    border: "1px solid #000",
    padding: "0.5rem",
    alignItems: "center",
    background: "#fff",
  },
  info: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  name: { fontSize: 12, fontWeight: 700, color: "#000" },
  meta: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  expiry: { fontSize: 10, fontFamily: "monospace", color: "#000" },
  source: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#000",
  },
  failure: { fontSize: 10, color: "#000", fontStyle: "italic" },
  verifyButton: {
    appearance: "none",
    border: "1px solid #b00020",
    background: "#fff",
    color: "#b00020",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    whiteSpace: "nowrap",
    cursor: "pointer",
    padding: "8px 10px",
    fontFamily: "inherit",
  },
};
