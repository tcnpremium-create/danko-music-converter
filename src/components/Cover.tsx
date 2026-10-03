// Portada: usa la imagen real si existe; si no, un gradiente determinista
// derivado del texto (para que demo/pistas sin carátula muestren algo estable).
import React from 'react';

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function Cover({
  src, seed, size = 40, radius = 8,
}: { src?: string | null; seed: string; size?: number; radius?: number }) {
  const style: React.CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0 };
  if (src) {
    return <img src={src} alt="" style={{ ...style, objectFit: 'cover' }} />;
  }
  const h = hashHue(seed);
  return (
    <div
      style={{
        ...style,
        background: `linear-gradient(135deg, hsl(${h} 60% 45%), hsl(${(h + 40) % 360} 65% 35%))`,
        display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.85)',
        fontSize: size * 0.4, fontWeight: 700,
      }}
    >
      ♪
    </div>
  );
}
