import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "../context/AuthContext";

const PAYMENT_SERVER_URL = import.meta.env.VITE_PAYMENT_SERVER_URL;
const SCANNER_ELEMENT_ID = "qr-scanner-region";

export default function OwnerScanner() {
  const { session } = useAuth();
  const [mode, setMode] = useState("entry"); // "entry" or "exit"
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const scannerRef = useRef(null);

  const startScanning = async () => {
    setResult(null);
    setError("");
    setScanning(true);
    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 220 },
        (decodedText) => handleScan(decodedText),
        () => {} // ignore per-frame "no QR found" noise
      );
    } catch (err) {
      setError("Couldn't access the camera. Check browser permissions.");
      setScanning(false);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // scanner may already be stopped
      }
    }
    setScanning(false);
  };

  const handleScan = async (qrToken) => {
    await stopScanning();
    try {
      const endpoint = mode === "entry" ? "scan-entry" : "scan-exit";
      const res = await fetch(`${PAYMENT_SERVER_URL}/api/checkin/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ qrToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
    };
  }, []);

  return (
    <div className="max-w-md mx-auto px-5 py-10">
      <h1 className="font-display text-2xl font-bold text-ink mb-1">Scan a booking</h1>
      <p className="text-asphalt/60 text-sm mb-6">
        Scan the rider's QR code at entry, and again when they leave.
      </p>

      <div className="flex rounded-full border border-ink/15 p-1 mb-6">
        {["entry", "exit"].map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setResult(null);
              setError("");
            }}
            className={`flex-1 py-2 rounded-full text-sm font-medium capitalize transition ${
              mode === m ? "bg-ink text-white" : "text-asphalt/60"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div
        id={SCANNER_ELEMENT_ID}
        className="rounded-2xl overflow-hidden bg-black/5 mb-4"
        style={{ minHeight: scanning ? 260 : 0 }}
      />

      {!scanning && (
        <button
          onClick={startScanning}
          className="w-full bg-signal text-white rounded-full py-3 font-medium hover:bg-signal/90"
        >
          Start scanning ({mode})
        </button>
      )}
      {scanning && (
        <button
          onClick={stopScanning}
          className="w-full border border-ink/15 rounded-full py-3 font-medium hover:bg-mist"
        >
          Stop
        </button>
      )}

      {error && <p className="text-red-600 text-sm mt-4">{error}</p>}

      {result && (
        <div className="mt-4 bg-go/10 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-go mb-1">{result.message}</p>
          {result.overtimeNote && <p className="text-asphalt/70">{result.overtimeNote}</p>}
          {result.finalAmount != null && (
            <p className="text-asphalt/70">Final amount: ₹{result.finalAmount}</p>
          )}
        </div>
      )}
    </div>
  );
}
