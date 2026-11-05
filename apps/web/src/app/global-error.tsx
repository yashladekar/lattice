"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf7f0",
          color: "#26231c",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ fontSize: "24px", margin: "0 0 8px" }}>Lattice hit a fatal error</h1>
          <p style={{ fontSize: "13px", lineHeight: 1.6, color: "#6b665a", margin: "0 0 16px" }}>
            Reloading usually clears this. Your locally stored notes are not affected.
            {error.digest ? ` (${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "1px solid #d8d2c4",
              borderRadius: "8px",
              background: "#ffffff",
              padding: "8px 16px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Reload Lattice
          </button>
        </div>
      </body>
    </html>
  );
}
