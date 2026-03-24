import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CONTINENT_OUTLINES, NODE_POSITIONS, type LatLon } from "./geo-data";

// ---------------------------------------------------------------------------
// Configuration — tweak these to customise the globe's appearance
// ---------------------------------------------------------------------------
export interface GlobeConfig {
  globeRadius: number;
  rotationSpeed: number;
  nodeCount: number;
  maxArcs: number;
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
  globeRadius: 1.6,
  rotationSpeed: 0.001,
  nodeCount: 30,
  maxArcs: 8,
  bloomStrength: 1.0,
  bloomRadius: 0.5,
  bloomThreshold: 0.05,
  colors: {
    globe: "#0e4d5c",
    land: "#00e5ff",
    node: "#00e5ff",
    arc: "#00e5ff",
    atmosphere: "#00bcd4",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert latitude / longitude (degrees) to a Vector3 on a sphere. */
function latLonToVec3(
  lat: number,
  lon: number,
  radius: number,
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Create a curved arc between two points on the sphere surface. */
function createArcCurve(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  segments = 64,
): THREE.Vector3[] {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  // Raise the midpoint above the sphere for the arc effect
  const dist = start.distanceTo(end);
  const altitude = radius + dist * 0.4;
  mid.normalize().multiplyScalar(altitude);

  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  return curve.getPoints(segments);
}

/** Generate a circular glow texture on a canvas. */
function createGlowTexture(size = 64): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Arc state
// ---------------------------------------------------------------------------
interface ArcState {
  mesh: THREE.Line;
  totalPoints: number;
  progress: number; // 0 → 1
  speed: number;
  phase: "growing" | "fading";
  opacity: number;
}

// ---------------------------------------------------------------------------
// GlobeScene — owns all Three.js resources
// ---------------------------------------------------------------------------
export class GlobeScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private composer!: EffectComposer;
  private globeGroup = new THREE.Group();
  private arcs: ArcState[] = [];
  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private config: GlobeConfig;
  private isMobile: boolean;
  private reducedMotion: boolean;

  constructor(
    private container: HTMLElement,
    config: Partial<GlobeConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isMobile = window.innerWidth < 768;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }

  /** Initialise and start the render loop. */
  init(): void {
    const { width, height } = this.container.getBoundingClientRect();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.z = 4.2;

    // Post-processing (bloom)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      this.config.bloomStrength,
      this.config.bloomRadius,
      this.config.bloomThreshold,
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    // Build scene
    this.scene.add(this.globeGroup);
    this.buildWireframe();
    this.buildContinents();
    this.buildNodes();
    this.buildAtmosphere();
    this.seedArcs();

    // Responsive resize
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Start
    this.animate();
  }

  // -----------------------------------------------------------------------
  // Scene construction
  // -----------------------------------------------------------------------

  /** Subtle latitude / longitude grid lines. */
  private buildWireframe(): void {
    const { globeRadius, colors } = this.config;
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(colors.globe),
      transparent: true,
      opacity: 0.08,
    });

    // Latitude rings
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lon = 0; lon <= 360; lon += 5) {
        pts.push(latLonToVec3(lat, lon, globeRadius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.globeGroup.add(new THREE.Line(geo, material));
    }
    // Longitude meridians
    for (let lon = 0; lon < 360; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 5) {
        pts.push(latLonToVec3(lat, lon, globeRadius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.globeGroup.add(new THREE.Line(geo, material));
    }
  }

  /** Continent outlines drawn as thin glowing lines. */
  private buildContinents(): void {
    const { globeRadius, colors } = this.config;
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(colors.land),
      transparent: true,
      opacity: 0.55,
    });

    for (const outline of CONTINENT_OUTLINES) {
      const pts = outline.map(([lon, lat]: LatLon) =>
        latLonToVec3(lat, lon, globeRadius * 1.002),
      );
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.globeGroup.add(new THREE.Line(geo, material));
    }
  }

  /** Glowing node sprites at city positions. */
  private buildNodes(): void {
    const { globeRadius, colors, nodeCount } = this.config;
    const glowTex = createGlowTexture();
    const nodes = NODE_POSITIONS.slice(0, nodeCount);

    for (const [lat, lon] of nodes) {
      const pos = latLonToVec3(lat, lon, globeRadius * 1.01);

      // Small core dot
      const dotGeo = new THREE.SphereGeometry(0.012, 6, 6);
      const dotMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.node),
      });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pos);
      this.globeGroup.add(dot);

      // Glow sprite
      const spriteMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(colors.node),
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(pos);
      sprite.scale.set(0.09, 0.09, 1);
      this.globeGroup.add(sprite);
    }
  }

  /** Fresnel-style atmosphere rim glow. */
  private buildAtmosphere(): void {
    const { globeRadius, colors } = this.config;
    const atmosGeo = new THREE.SphereGeometry(globeRadius * 1.15, 48, 48);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = 1.0 - dot(viewDir, vNormal);
          fresnel = pow(fresnel, 3.5);
          gl_FragColor = vec4(uColor, fresnel * 0.35);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color(colors.atmosphere) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.globeGroup.add(new THREE.Mesh(atmosGeo, atmosMat));
  }

  // -----------------------------------------------------------------------
  // Arc system
  // -----------------------------------------------------------------------

  /** Populate initial set of arcs. */
  private seedArcs(): void {
    const count = this.isMobile
      ? Math.min(4, this.config.maxArcs)
      : this.config.maxArcs;
    for (let i = 0; i < count; i++) {
      this.spawnArc();
    }
  }

  /** Create a new random arc between two nodes. */
  private spawnArc(): void {
    const { globeRadius, colors, nodeCount } = this.config;
    const nodes = NODE_POSITIONS.slice(0, nodeCount);
    const a = Math.floor(Math.random() * nodes.length);
    let b = Math.floor(Math.random() * nodes.length);
    while (b === a) b = Math.floor(Math.random() * nodes.length);

    const start = latLonToVec3(nodes[a][0], nodes[a][1], globeRadius * 1.005);
    const end = latLonToVec3(nodes[b][0], nodes[b][1], globeRadius * 1.005);
    const curvePoints = createArcCurve(start, end, globeRadius);

    const geo = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(colors.arc),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.geometry.setDrawRange(0, 0);
    this.globeGroup.add(line);

    this.arcs.push({
      mesh: line,
      totalPoints: curvePoints.length,
      progress: 0,
      speed: 0.004 + Math.random() * 0.006,
      phase: "growing",
      opacity: 0.9,
    });
  }

  /** Advance arc animations and recycle completed arcs. */
  private updateArcs(): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];

      if (arc.phase === "growing") {
        arc.progress += arc.speed;
        const drawCount = Math.floor(arc.progress * arc.totalPoints);
        arc.mesh.geometry.setDrawRange(0, drawCount);
        if (arc.progress >= 1) {
          arc.phase = "fading";
        }
      } else {
        // Fade out then remove
        arc.opacity -= 0.012;
        (arc.mesh.material as THREE.LineBasicMaterial).opacity = Math.max(
          0,
          arc.opacity,
        );
        if (arc.opacity <= 0) {
          this.globeGroup.remove(arc.mesh);
          arc.mesh.geometry.dispose();
          (arc.mesh.material as THREE.Material).dispose();
          this.arcs.splice(i, 1);
          // Replace with a new arc
          this.spawnArc();
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------------

  private animate = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);

    // Rotate globe (skip if user prefers reduced motion)
    if (!this.reducedMotion) {
      this.globeGroup.rotation.y += this.config.rotationSpeed;
    }
    this.updateArcs();
    this.composer.render();
  };

  // -----------------------------------------------------------------------
  // Resize / cleanup
  // -----------------------------------------------------------------------

  private handleResize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  /** Tear down all resources — call on unmount. */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          (obj.material as THREE.Material).dispose();
        }
      }
      if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
