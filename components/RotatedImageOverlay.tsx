'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

// Suprapune o imagine (ex. captură Google Earth mai recentă) peste harta reală,
// ancorată prin 3 puncte GPS: colț stânga-sus, dreapta-sus, stânga-jos. Calculează
// o transformare afină (scalare + rotație + oblicitate, fără plugin extern) care
// mapează dreptunghiul natural al imaginii peste cele 3 puncte, la fel cum
// funcționează pluginul „Leaflet.ImageOverlay.Rotated", dar implementat direct.
export default function RotatedImageOverlay({
  imageUrl,
  topLeft,
  topRight,
  bottomLeft,
  opacity,
  visible,
}: {
  imageUrl: string;
  topLeft: [number, number];
  topRight: [number, number];
  bottomLeft: [number, number];
  opacity: number;
  visible: boolean;
}) {
  const map = useMap();
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const pane = map.getPanes().overlayPane;
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.position = 'absolute';
    img.style.transformOrigin = '0 0';
    img.style.pointerEvents = 'none';
    img.style.maxWidth = 'none';
    pane.appendChild(img);
    imgElRef.current = img;

    function reset() {
      const size = naturalSizeRef.current;
      if (!size) return;

      const p0 = map.latLngToLayerPoint(topLeft);
      const p1 = map.latLngToLayerPoint(topRight);
      const p2 = map.latLngToLayerPoint(bottomLeft);

      const a = (p1.x - p0.x) / size.w;
      const b = (p1.y - p0.y) / size.w;
      const c = (p2.x - p0.x) / size.h;
      const d = (p2.y - p0.y) / size.h;

      img.style.width = `${size.w}px`;
      img.style.height = `${size.h}px`;
      img.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${p0.x}, ${p0.y})`;
    }

    function onLoad() {
      naturalSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      reset();
    }

    img.addEventListener('load', onLoad);
    if (img.complete && img.naturalWidth) onLoad();

    map.on('zoom viewreset move', reset);

    return () => {
      map.off('zoom viewreset move', reset);
      img.removeEventListener('load', onLoad);
      pane.removeChild(img);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, imageUrl, topLeft[0], topLeft[1], topRight[0], topRight[1], bottomLeft[0], bottomLeft[1]]);

  useEffect(() => {
    if (imgElRef.current) {
      imgElRef.current.style.opacity = visible ? String(opacity) : '0';
    }
  }, [opacity, visible]);

  return null;
}
