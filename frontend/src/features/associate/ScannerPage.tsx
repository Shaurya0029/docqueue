import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../../components/icons";
import { Alert, Button, PageHeader } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useActiveDoctor } from "./ActiveDoctorContext";
import { useScanQr } from "./hooks";
import { useT } from "../../lib/i18n";

const SCANNER_ELEMENT_ID = "medora-qr-scanner";

type ScanResult =
  | { kind: "success"; name: string | null; token: number | null; paymentStatus: string }
  | { kind: "error"; message: string };

export function ScannerPage() {
  const t = useT();
  const { doctorId } = useActiveDoctor();
  const scanQr = useScanQr();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (decodedText) => handleScan(decodedText),
        () => {}
      )
      .catch((err) => setCameraError(String(err)));

    return () => {
      // stop() throws synchronously if the camera never started (no camera / permission denied).
      try {
        if (scanner.isScanning) {
          void scanner.stop().then(() => scanner.clear()).catch(() => {});
        } else {
          scanner.clear();
        }
      } catch {
        /* scanner already torn down */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScan(token: string) {
    const now = Date.now();
    // Debounce: ignore the same QR firing repeatedly while held in frame.
    if (busyRef.current) return;
    if (lastTokenRef.current?.token === token && now - lastTokenRef.current.at < 4000) return;
    lastTokenRef.current = { token, at: now };
    busyRef.current = true;

    scanQr.mutate(token, {
      onSuccess: (data) => {
        setResult({ kind: "success", name: data.name, token: data.queueToken, paymentStatus: data.paymentStatus });
        busyRef.current = false;
      },
      onError: (err) => {
        setResult({ kind: "error", message: apiErrorMessage(err) });
        busyRef.current = false;
      },
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Front desk")} title={t("Scan patient QR")} subtitle={doctorId ? t("Hold the patient's ticket inside the frame.") : t("Select a doctor above to start checking patients in.")} />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-night p-2 shadow-float">
        <div id={SCANNER_ELEMENT_ID} className="min-h-[260px] overflow-hidden rounded-2xl" />
        {/* viewfinder corners */}
        <div className="pointer-events-none absolute inset-8">
          {["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"].map((c) => (
            <span key={c} className={`absolute h-10 w-10 border-sky-400 ${c}`} />
          ))}
          <motion.span
            className="absolute inset-x-4 h-0.5 rounded-full bg-sky-400 shadow-[0_0_16px_2px_rgb(var(--g3)/0.8)]"
            animate={{ top: ["10%", "90%", "10%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
      <Alert>{cameraError ? t("Camera unavailable: {error}. Check browser camera permissions.", { error: cameraError }) : null}</Alert>

      </div>
      <div>
      {!result && (
        <div className="hidden min-h-[260px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-surface/60 p-8 text-center lg:flex">
          <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
            <Icon name="qr" className="h-7 w-7" />
          </span>
          <p className="font-bold text-ink">{t("Waiting for a scan")}</p>
          <p className="mt-1 max-w-xs text-sm text-muted">{t("Check-in details will appear here.")}</p>
        </div>
      )}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={result.kind === "success" ? `ok-${result.token}` : `err-${result.message}`}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className={`rounded-3xl p-5 ring-1 ${result.kind === "success" ? "bg-success-soft ring-success/25" : "bg-danger-soft ring-danger/25"}`}
          >
            {result.kind === "success" ? (
              <div className="flex items-center gap-4">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-success text-white"
                >
                  <Icon name="check" className="h-7 w-7" strokeWidth={3} />
                </motion.span>
                <div className="min-w-0">
                  <p className="text-lg font-extrabold text-success">{t("Checked in")}</p>
                  <p className="truncate font-semibold text-ink">{result.name ?? t("Patient")}</p>
                  <p className="text-sm text-muted">
                    {t("Token")} <span className="font-bold text-ink">#{result.token}</span> · {t("Payment")} {t(result.paymentStatus.toLowerCase())}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface text-danger">
                  <Icon name="alert" />
                </span>
                <p className="font-semibold text-danger">{result.message}</p>
              </div>
            )}
            <Button variant="secondary" icon="scan" className="mt-4 w-full" onClick={() => setResult(null)}>
              {t("Scan next")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      </div>
    </div>
  );
}
