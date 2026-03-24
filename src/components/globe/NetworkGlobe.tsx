"use client";

import { useEffect, useRef } from "react";
import type { GlobeConfig } from "./globe-scene";

interface NetworkGlobeProps {
  config?: Partial<GlobeConfig>;
  className?: string;
}

/**
 * Animated 3D network globe rendered with Three.js.
 * Dynamically imported to avoid SSR issues with WebGL APIs.
 */
export default function NetworkGlobe({
  config,
  className = "",
}: NetworkGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let globe: InstanceType<typeof import("./globe-scene").GlobeScene> | null =
      null;

    // Dynamic import keeps Three.js out of the server bundle
    import("./globe-scene").then(({ GlobeScene }) => {
      if (!el.isConnected) return; // unmounted before import resolved
      globe = new GlobeScene(el, config);
      globe.init();
    });

    return () => {
      globe?.dispose();
    };
  }, [config]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className}`}
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    />
  );
}
