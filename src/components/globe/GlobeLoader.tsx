"use client";

import dynamic from "next/dynamic";

const NetworkGlobe = dynamic(() => import("./NetworkGlobe"), { ssr: false });

/** Client-side wrapper that lazy-loads the WebGL globe (no SSR). */
export default function GlobeLoader() {
  return <NetworkGlobe />;
}
