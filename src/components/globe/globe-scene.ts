import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CONTINENT_OUTLINES, NODE_POSITIONS, type LatLon } from "./geo-data";

// ---------------------------------------------------------------------------
// Configuration — edit these defaults to customise the globe
// ---------------------------------------------------------------------------
export interface GlobeConfig {
  globeRadius: number;
  rotationSpeed: number;
  /** Max cities shown (capped to NODE_POSITIONS length) */
  nodeCount: number;
  /** Max simultaneous arcs (auto-reduced on smaller screens) */
  maxArcs: number;
  /** Length of the traveling beam as a fraction of the arc (0–1) */
  beamLength: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  colors: {
    globe: string;
    land: string;
    node: string;
    arc: string;
    atmosphere: string;
  };
}

export const DEFAULT_CONFIG: GlobeConfig = {
  globeRadius: 1.2,
  rotationSpeed: 0.0008,
  nodeCount: 30,
  maxArcs: 6,
  beamLength: 0.35,
  bloomStrength: 0.25,
  bloomRadius: 0.3,
  bloomThreshold: 0.6,
  colors: {
    globe: "#0d6e7e",
    land: "#00e5ff",
    node: "#00ffff",
    arc: "#00e5ff",
    atmosphere: "#00bcd4",
  },
};

// ---------------------------------------------------------------------------
// Responsive tier — scales detail by viewport width
// ---------------------------------------------------------------------------
type Tier = "mobile" | "tablet" | "desktop";

function detectTier(): Tier {
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

const TIER_SETTINGS: Record<Tier, { arcScale: number; nodeScale: number; bloomScale: number }> = {
  mobile:  { arcScale: 0.38, nodeScale: 0.5,  bloomScale: 0.7 },
  tablet:  { arcScale: 0.62, nodeScale: 0.7,  bloomScale: 0.85 },
  desktop: { arcScale: 1,    nodeScale: 1,    bloomScale: 1 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Great-circle arc raised above the surface. */
function buildArcPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments = 64,
): THREE.Vector3[] {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const dist = start.distanceTo(end);
  mid.normalize().multiplyScalar(radius + dist * 0.35);
  return new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(segments);
}

function createGlowTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Depth-fade materials — front hemisphere crisp, back hemisphere dimmed
// ---------------------------------------------------------------------------

const DEPTH_FADE_VERTEX = `
  varying float vFacing;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(worldPos.xyz), normalize(cameraPosition));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

function depthFadeFragment(additive: boolean): string {
  // smoothstep maps facing from back→front into 0→1
  return `
    uniform vec3 uColor;
    uniform float uFrontAlpha;
    uniform float uBackAlpha;
    varying float vFacing;
    void main() {
      float fade = smoothstep(-0.2, 0.5, vFacing);
      float alpha = mix(uBackAlpha, uFrontAlpha, fade);
      ${additive ? "" : "if (alpha < 0.005) discard;"}
      gl_FragColor = vec4(uColor, alpha);
    }
  `;
}

function createDepthFadeMaterial(
  color: string,
  frontAlpha: number,
  backAlpha: number,
  opts: { additive?: boolean } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DEPTH_FADE_VERTEX,
    fragmentShader: depthFadeFragment(!!opts.additive),
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFrontAlpha: { value: frontAlpha },
      uBackAlpha: { value: backAlpha },
    },
    transparent: true,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
}

// ---------------------------------------------------------------------------
// Arc state — each beam travelling between two nodes
// ---------------------------------------------------------------------------
interface ArcState {
  line: THREE.Line;
  headSprite: THREE.Sprite;
  points: THREE.Vector3[];
  /** Parameter that advances from 0 → points.length + beamLen */
  t: number;
  beamLen: number;
  speed: number;
  /** Frames to wait before the beam starts traveling (organic stagger) */
  delay: number;
}

// ---------------------------------------------------------------------------
// GlobeScene
// ---------------------------------------------------------------------------
export class GlobeScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private globeGroup = new THREE.Group();
  private arcs: ArcState[] = [];
  private nodeSprites: THREE.Sprite[] = [];
  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer = 0;

  private readonly config: GlobeConfig;
  private tier: Tier;
  private readonly reducedMotion: boolean;
  private glowTexture!: THREE.CanvasTexture;

  // Reusable temp vector for per-frame calculations
  private readonly _worldPos = new THREE.Vector3();

  constructor(private container: HTMLElement, overrides: Partial<GlobeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
    this.tier = detectTier();
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  init(): void {
    const { width, height } = this.container.getBoundingClientRect();
    this.glowTexture = createGlowTexture();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // Scene & camera — offset globe to the right so it doesn't dominate the text area
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(-0.6, 0.2, 5.2);

    // Bloom
    const ts = TIER_SETTINGS[this.tier];
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(width, height),
        this.config.bloomStrength * ts.bloomScale,
        this.config.bloomRadius,
        this.config.bloomThreshold,
      ),
    );
    this.composer.addPass(new OutputPass());

    // Build scene elements
    this.scene.add(this.globeGroup);
    this.buildGrid();
    this.buildContinents();
    this.buildNodes();
    this.buildAtmosphere();
    if (!this.reducedMotion) this.seedArcs();

    // Observe resize (debounced)
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.handleResize(), 150);
    });
    this.resizeObserver.observe(this.container);

    this.animate();
  }

  // -----------------------------------------------------------------------
  // Scene construction
  // -----------------------------------------------------------------------

  private buildGrid(): void {
    const { globeRadius, colors } = this.config;
    const mat = createDepthFadeMaterial(colors.globe, 0.12, 0.02);

    // Sparse latitude rings (equator + ±40°)
    for (const lat of [-40, 0, 40]) {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 4) pts.push(latLonToVec3(lat, lon, globeRadius));
      this.globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    // Sparse meridians (every 60°)
    for (let lon = 0; lon < 360; lon += 60) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(latLonToVec3(lat, lon, globeRadius));
      this.globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }

  private buildContinents(): void {
    const { globeRadius, colors } = this.config;
    const mat = createDepthFadeMaterial(colors.land, 0.8, 0.06);

    for (const outline of CONTINENT_OUTLINES) {
      const pts = outline.map(([lon, lat]: LatLon) =>
        latLonToVec3(lat, lon, globeRadius * 1.002),
      );
      this.globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }

  private buildNodes(): void {
    const { globeRadius, colors, nodeCount } = this.config;
    const ts = TIER_SETTINGS[this.tier];
    const count = Math.min(
      Math.round(nodeCount * ts.nodeScale),
      NODE_POSITIONS.length,
    );

    const dotGeo = new THREE.SphereGeometry(0.013, 6, 6);
    const dotMat = createDepthFadeMaterial(colors.node, 1.0, 0.08);

    for (let i = 0; i < count; i++) {
      const [lat, lon] = NODE_POSITIONS[i];
      const pos = latLonToVec3(lat, lon, globeRadius * 1.01);

      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pos);
      this.globeGroup.add(dot);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: new THREE.Color(colors.node),
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.position.copy(pos);
      sprite.scale.set(0.07, 0.07, 1);
      this.globeGroup.add(sprite);
      this.nodeSprites.push(sprite);
    }
  }

  private buildAtmosphere(): void {
    const { globeRadius, colors } = this.config;
    // FrontSide sphere — Fresnel is zero at centre, peaks at edges only.
    // Radius barely exceeds the globe so the glow hugs the coastline edge.
    const geo = new THREE.SphereGeometry(globeRadius * 1.008, 48, 48);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * vec4(vPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          float rim = 1.0 - abs(dot(normalize(-vPos), vNormal));
          float glow = pow(rim, 8.0) * 0.3;
          gl_FragColor = vec4(uColor, glow);
        }
      `,
      uniforms: { uColor: { value: new THREE.Color(colors.atmosphere) } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this.globeGroup.add(new THREE.Mesh(geo, mat));
  }

  // -----------------------------------------------------------------------
  // Arc system — traveling energy beams
  // -----------------------------------------------------------------------

  private seedArcs(): void {
    const ts = TIER_SETTINGS[this.tier];
    const count = Math.max(2, Math.round(this.config.maxArcs * ts.arcScale));
    for (let i = 0; i < count; i++) {
      this.spawnArc(Math.round(Math.random() * 90));
    }
  }

  private spawnArc(delay = 0): void {
    const { globeRadius, colors, nodeCount, beamLength } = this.config;
    const ts = TIER_SETTINGS[this.tier];
    const nodeLimit = Math.min(Math.round(nodeCount * ts.nodeScale), NODE_POSITIONS.length);

    const a = Math.floor(Math.random() * nodeLimit);
    let b = Math.floor(Math.random() * nodeLimit);
    while (b === a) b = Math.floor(Math.random() * nodeLimit);

    const start = latLonToVec3(NODE_POSITIONS[a][0], NODE_POSITIONS[a][1], globeRadius * 1.005);
    const end = latLonToVec3(NODE_POSITIONS[b][0], NODE_POSITIONS[b][1], globeRadius * 1.005);
    const points = buildArcPoints(start, end, globeRadius);
    const variation = 0.7 + Math.random() * 0.6;
    const beamLen = Math.max(4, Math.round(points.length * beamLength * variation));

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = createDepthFadeMaterial(colors.arc, 0.9, 0.1, { additive: true });
    const line = new THREE.Line(geo, mat);
    line.geometry.setDrawRange(0, 0);
    line.visible = false;
    this.globeGroup.add(line);

    const headSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: new THREE.Color(colors.arc),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    headSprite.scale.set(0.08, 0.08, 1);
    headSprite.visible = false;
    this.globeGroup.add(headSprite);

    this.arcs.push({
      line,
      headSprite,
      points,
      t: 0,
      beamLen,
      speed: 0.3 + Math.random() * 0.6,
      delay,
    });
  }

  private updateArcs(): void {
    const camDir = this.camera.position.clone().normalize();

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];

      if (arc.delay > 0) {
        arc.delay--;
        continue;
      }

      arc.line.visible = true;
      arc.t += arc.speed;

      const head = Math.min(Math.floor(arc.t), arc.points.length);
      const tail = Math.max(0, Math.floor(arc.t) - arc.beamLen);
      const drawStart = Math.min(tail, arc.points.length);
      const drawCount = Math.max(0, head - drawStart);

      arc.line.geometry.setDrawRange(drawStart, drawCount);

      const headIdx = Math.min(head, arc.points.length - 1);
      arc.headSprite.position.copy(arc.points[headIdx]);
      arc.headSprite.visible = head > 0 && head < arc.points.length;

      // Fade arc head sprite based on hemisphere facing
      if (arc.headSprite.visible) {
        arc.headSprite.getWorldPosition(this._worldPos);
        const facing = this._worldPos.normalize().dot(camDir);
        const fade = THREE.MathUtils.smoothstep(facing, -0.2, 0.5);
        (arc.headSprite.material as THREE.SpriteMaterial).opacity = 0.85 * fade;
      }

      if (tail >= arc.points.length) {
        this.removeArc(i);
        this.spawnArc(30 + Math.round(Math.random() * 90));
      }
    }
  }

  private removeArc(index: number): void {
    const arc = this.arcs[index];
    this.globeGroup.remove(arc.line);
    this.globeGroup.remove(arc.headSprite);
    arc.line.geometry.dispose();
    (arc.line.material as THREE.Material).dispose();
    (arc.headSprite.material as THREE.SpriteMaterial).dispose();
    this.arcs.splice(index, 1);
  }

  // -----------------------------------------------------------------------
  // Per-frame depth fade for sprites (can't use shader — always face camera)
  // -----------------------------------------------------------------------

  private updateSpriteFacing(): void {
    const camDir = this.camera.position.clone().normalize();
    for (const sprite of this.nodeSprites) {
      sprite.getWorldPosition(this._worldPos);
      const facing = this._worldPos.normalize().dot(camDir);
      const fade = THREE.MathUtils.smoothstep(facing, -0.2, 0.5);
      (sprite.material as THREE.SpriteMaterial).opacity = 0.6 * fade;
    }
  }

  // -----------------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------------

  private animate = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);

    if (!this.reducedMotion) {
      this.globeGroup.rotation.y += this.config.rotationSpeed;
      this.updateArcs();
    }
    this.updateSpriteFacing();
    this.composer.render();
  };

  // -----------------------------------------------------------------------
  // Resize & cleanup
  // -----------------------------------------------------------------------

  private handleResize(): void {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    this.tier = detectTier();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();

    while (this.arcs.length) this.removeArc(0);
    this.nodeSprites.length = 0;

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
      if (obj instanceof THREE.Sprite) {
        obj.material.dispose();
      }
    });

    this.glowTexture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
