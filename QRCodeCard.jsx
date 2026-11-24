import { useEffect, useRef } from "react";
import QRCode from "qrcode";

// Renders the booking's qr_token as a scannable QR code. The owner scans
// this once at entry and once at exit - see OwnerScanner.jsx.
export default function QRCodeCard({ qrToken, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && qrToken) {
      QRCode.toCanvas(canvasRef.current, qrToken, { width: 180, margin: 1 });
    }
  }, [qrToken]);

  return (
    <div className="bg-white border border-black/5 rounded-2xl p-5 flex flex-col items-center text-center">
      <canvas ref={canvasRef} />
      <p className="text-sm font-medium text-ink mt-3">{label || "Show this at the gate"}</p>
      <p className="text-xs text-asphalt/50 mt-1">
        The parking attendant scans this once when you arrive, and again when you leave.
      </p>
    </div>
  );
}
