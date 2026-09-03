import { useMemo } from "react";
import { createReceiveQr } from "./receive_qr.ts";

const QUIET_ZONE_MODULES = 4;

function modulePath(matrix: boolean[][]): string {
  const segments: string[] = [];
  for (let row = 0; row < matrix.length; row++) {
    for (let column = 0; column < matrix[row].length; column++) {
      if (matrix[row][column]) {
        segments.push(
          `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`,
        );
      }
    }
  }
  return segments.join("");
}

export function ReceiveQr({ address }: { address: string }) {
  const qr = useMemo(() => {
    const encoded = createReceiveQr(address);
    return {
      path: modulePath(encoded.matrix),
      dimension: encoded.size + QUIET_ZONE_MODULES * 2,
      payload: encoded.payload,
    };
  }, [address]);

  return (
    <figure className="receive-qr">
      <svg
        viewBox={`0 0 ${qr.dimension} ${qr.dimension}`}
        role="img"
        aria-label={`QR code for receive address ${qr.payload}`}
        shapeRendering="crispEdges"
      >
        <title>Receive address QR code</title>
        <rect width={qr.dimension} height={qr.dimension} fill="#fff" />
        <path d={qr.path} fill="#07100d" />
      </svg>
    </figure>
  );
}
