"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// La API de detección de códigos de barras todavía no está en los tipos de TypeScript.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare const BarcodeDetector: {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
};

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const supported = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * Botón para escanear el código de barras de un producto con la cámara y abrir su ficha.
 * Solo aparece en los navegadores con BarcodeDetector (Chrome y Edge en Android y escritorio).
 */
export function ScanButton() {
  const canScan = useSyncExternalStore(
    () => () => {},
    supported,
    () => false,
  );
  const [open, setOpen] = useState(false);
  // Estable: si cambiara en cada render, el escáner reiniciaría la cámara.
  const close = useCallback(() => setOpen(false), []);
  if (!canScan) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent hover:text-accent"
        aria-label="Escanear código de barras"
        title="Escanear código de barras"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8" />
        </svg>
      </button>
      {open && <Scanner onClose={close} />}
    </>
  );
}

function Scanner({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const detector = new BarcodeDetector({ formats: FORMATS });

    async function scan() {
      if (stopped || !video.current) return;
      try {
        if (video.current.readyState >= 2) {
          const [code] = await detector.detect(video.current);
          if (code?.rawValue && /^\d{8,14}$/.test(code.rawValue)) {
            stopped = true;
            navigator.vibrate?.(80);
            onClose();
            router.push(`/ean/${code.rawValue}`);
            return;
          }
        }
      } catch {
        // Un cuadro que no se pudo analizar: se prueba con el siguiente.
      }
      frame = requestAnimationFrame(scan);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (s) => {
        stream = s;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        scan();
      })
      .catch(() => setError("No pudimos usar la cámara. Revisá que el navegador tenga permiso."));

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Escanear código de barras" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface">
        <div className="relative aspect-[4/3] bg-black">
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80" />
        </div>
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">{error ?? "Apuntá al código de barras del producto."}</p>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
