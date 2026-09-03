import * as jsQrModule from "jsqr";
import { useEffect, useRef, useState } from "react";
import type { ChainId } from "../core/types.ts";
import { destinationFromQrPayload } from "./qr_scan.ts";
import { Spinner } from "./shared.tsx";

type QrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: "attemptBoth" },
) => { data: string } | null;

const decodeQr = jsQrModule.default as unknown as QrDecoder;

interface QrScannerModalProps {
  chain: ChainId;
  onCancel(): void;
  onScan(address: string): void;
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera permission was denied. Allow camera access, then open the scanner again.";
    }
    if (error.name === "NotFoundError") return "No camera was found on this device.";
    if (error.name === "NotReadableError") {
      return "The camera is unavailable or already in use by another application.";
    }
  }
  return error instanceof Error ? error.message : "Unable to start the camera.";
}

export function QrScannerModal({ chain, onCancel, onScan }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScanRef = useRef(onScan);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | undefined;
    let animationFrame = 0;
    let lastScanAt = 0;

    function stopCamera() {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function scanFrame(timestamp: number) {
      if (disposed) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (
        video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 && timestamp - lastScanAt >= 180
      ) {
        lastScanAt = timestamp;
        const scale = Math.min(1, 720 / video.videoWidth);
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          const image = context.getImageData(0, 0, width, height);
          const result = decodeQr(image.data, width, height, { inversionAttempts: "attemptBoth" });
          if (result) {
            try {
              const address = destinationFromQrPayload(result.data);
              stopCamera();
              onScanRef.current(address);
              return;
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Unsupported QR code");
            }
          }
        }
      }
      animationFrame = requestAnimationFrame(scanFrame);
    }

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not supported by this system webview.");
        }
        const requested = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (disposed) {
          requested.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = requested;
        const video = videoRef.current;
        if (!video) throw new Error("Camera preview is unavailable");
        video.srcObject = stream;
        await video.play();
        if (disposed) return;
        setReady(true);
        animationFrame = requestAnimationFrame(scanFrame);
      } catch (cause) {
        if (!disposed) setError(cameraError(cause));
        stream?.getTracks().forEach((track) => track.stop());
      }
    }

    startCamera();
    return stopCamera;
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <section
        className="modal scanner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="scanner-header">
          <div>
            <div className="eyebrow">{chain.toUpperCase()} DESTINATION</div>
            <h2 id="scanner-title">Scan QR code</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close scanner"
            onClick={onCancel}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="scanner-viewport">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          <div className="scanner-guide" aria-hidden="true" />
          {!ready && !error && (
            <div className="scanner-loading">
              <Spinner /> Starting camera
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="scanner-canvas" aria-hidden="true" />
        <p className="scanner-help">
          Point the camera at a QR code containing a mainnet P2TR, P2WPKH, or P2WSH address.
        </p>
        {error && <div className="error-box scanner-error">{error}</div>}
      </section>
    </div>
  );
}
