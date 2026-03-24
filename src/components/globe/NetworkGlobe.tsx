"use client";

import { useEffect, useRef } from "react";
import { GlobeScene, type GlobeConfig } from "./globe-scene";

interface NetworkGlobeProps {
  config?: Partial<GlobeConfig>;
  className?: string;
}

/**
 * Animated 3D network globe. Must be loaded behind `ssr: false`
 * (via GlobeLoader) so Three.js never runs on the server.
 */
export default function NetworkGlobe({
  config,
  className = "",
}: NetworkGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const globe = new GlobeScene(el, configRef.current);
    globe.init();

    return () => globe.dispose();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className}`}
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    />
  );
}
