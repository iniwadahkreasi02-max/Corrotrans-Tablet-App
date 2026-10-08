import { useMemo } from 'react';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';

export default function PairingQrCode({ value }: { value: string }) {
  const matrix = useMemo(
    () => new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, new Map()),
    [value],
  );
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  let path = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matrix.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg
      className="vd-pairing-qr"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Tablet pairing QR code"
      shapeRendering="crispEdges"
    >
      <rect width={width} height={height} fill="hsl(var(--background))" />
      <path d={path} fill="hsl(var(--foreground))" />
    </svg>
  );
}