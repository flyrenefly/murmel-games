import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { isDeadly, type Level } from '../game/level';
import type { StoneState } from '../game/pairs';
import { MARBLE_RADIUS } from '../game/physics';
import type { ActorSprite } from './classic';
import { blobShadow } from './textures';
import { createTheme, type ThemeId, type ThemeKit } from './themes';

const WALL_H = 0.7;
const STONE_H = 0.6;
const FLOOR_H = 0.3;
const CAM_DIR = new THREE.Vector3(0, 1, 0.42).normalize();

/** Three.js scene for one level in one theme. World: x = column, z = row, y = up. */
export class View {
  readonly renderer: THREE.WebGLRenderer;
  private readonly perspective = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private camera: THREE.Camera = this.perspective;
  private scene = new THREE.Scene();
  private composer: EffectComposer | null = null;
  private kit: ThemeKit | null = null;
  private level: Level | null = null;
  private stoneTops: (THREE.MeshStandardMaterial | THREE.MeshBasicMaterial)[] = [];
  private stoneMeshes: THREE.Object3D[] = [];
  private readonly sphere: THREE.Mesh;
  private readonly sprite: THREE.Mesh;
  private marble: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private followLight: THREE.PointLight | null = null;
  private readonly shadowTex = blobShadow();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpAxis = new THREE.Vector3();
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private pulses: { obj: THREE.Object3D; t: number }[] = [];
  /** Rotors, tops and killers: simple spheres. */
  private actorMeshes: THREE.Mesh[] = [];
  /** Rubber bands as line segments. */
  private bands: THREE.LineSegments | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_RADIUS, 48, 32));
    this.sprite = new THREE.Mesh(new THREE.PlaneGeometry(10 / 16, 10 / 16).rotateX(-Math.PI / 2));
    this.marble = this.sphere;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(MARBLE_RADIUS * 3, MARBLE_RADIUS * 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
    );
  }

  get themeLabel(): string {
    return this.kit?.label ?? '';
  }

  build(level: Level, theme: ThemeId, states: readonly StoneState[]): void {
    this.clear();
    this.level = level;
    const kit = (this.kit = createTheme(theme));
    const scene = (this.scene = new THREE.Scene());
    scene.background = kit.background;
    this.followLight = kit.addLights(scene, this.renderer);

    const W = level.width;
    const floorCells: [number, number][] = [];
    const wallCells: [number, number][] = [];
    level.cells.forEach((c, i) => {
      const col = i % W;
      const row = Math.floor(i / W);
      if (c.stone !== null && c.stone !== 'st_oxyd') wallCells.push([col, row]);
      else if (!isDeadly(c.floor)) floorCells.push([col, row]);
    });

    // Floor: one instanced mesh = one draw call.
    const m = new THREE.Matrix4();
    const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(1, FLOOR_H, 1), kit.floor, floorCells.length);
    floorCells.forEach(([c, r], i) => {
      floor.setMatrixAt(i, m.makeTranslation(c + 0.5, -FLOOR_H / 2, r + 0.5));
      const tint = kit.floorTint(hash(c, r));
      if (tint) floor.setColorAt(i, tint);
    });
    scene.add(floor);

    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_H, 1), kit.wall, wallCells.length);
    wallCells.forEach(([c, r], i) => walls.setMatrixAt(i, m.makeTranslation(c + 0.5, WALL_H / 2, r + 0.5)));
    scene.add(walls);

    if (kit.wallEdges) {
      // Top outline of every wall block, merged into one line mesh.
      const pts: number[] = [];
      const y = WALL_H + 0.002;
      for (const [c, r] of wallCells) {
        const sides: [number, number, number, number, boolean][] = [
          [c, r, c + 1, r, !isWall(level, c, r - 1)],
          [c, r + 1, c + 1, r + 1, !isWall(level, c, r + 1)],
          [c, r, c, r + 1, !isWall(level, c - 1, r)],
          [c + 1, r, c + 1, r + 1, !isWall(level, c + 1, r)],
        ];
        for (const [x1, z1, x2, z2, show] of sides) if (show) pts.push(x1, y, z1, x2, y, z2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      scene.add(new THREE.LineSegments(g, kit.wallEdges));
    }

    // Deep backdrop below the floor: visible through every abyss cell.
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, level.height + 40).rotateX(-Math.PI / 2), kit.abyss);
    abyss.position.set(W / 2, -2.5, level.height / 2);
    scene.add(abyss);

    const bodyGeo = new THREE.BoxGeometry(0.96, STONE_H, 0.96);
    const topGeo = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    this.stoneTops = [];
    this.stoneMeshes = [];
    for (const s of level.signals) {
      const group = new THREE.Group();
      group.position.set(s.col + 0.5, 0, s.row + 0.5);
      const body = new THREE.Mesh(bodyGeo, kit.stoneBody);
      body.position.y = STONE_H / 2;
      // Pixel style is unlit: flat colours exactly as drawn.
      const mat = kit.pixelTile
        ? new THREE.MeshBasicMaterial({ toneMapped: false })
        : new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 });
      if (kit.face.glow && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive = new THREE.Color('#ffffff');
        mat.emissiveIntensity = 0.9;
      }
      const top = new THREE.Mesh(topGeo, mat);
      top.position.y = STONE_H + 0.003;
      group.add(body, top);
      scene.add(group);
      this.stoneTops.push(mat);
      this.stoneMeshes.push(group);
    }
    states.forEach((st, i) => this.setStoneState(i, st, false));

    this.marble = kit.marbleSprite ? this.sprite : this.sphere;
    this.marble.material = kit.marble;
    const shadowMat = this.shadow.material as THREE.MeshBasicMaterial;
    shadowMat.map = kit.shadowTexture ?? this.shadowTex;
    shadowMat.opacity = kit.shadowOpacity;
    shadowMat.needsUpdate = true;
    this.shadow.scale.setScalar(kit.marbleSprite ? (10 / 16) / (MARBLE_RADIUS * 3) : 1);
    this.camera = kit.view === 'top' ? this.ortho : this.perspective;
    const canvas = this.renderer.domElement;
    canvas.style.imageRendering = kit.pixelTile ? 'pixelated' : '';
    document.body.dataset.theme = kit.id;
    scene.add(this.marble, this.shadow);

    if (kit.bloom) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(scene, this.perspective));
      const size = this.renderer.getSize(new THREE.Vector2());
      composer.addPass(new UnrealBloomPass(size.clone().multiplyScalar(0.5), kit.bloom.strength, kit.bloom.radius, kit.bloom.threshold));
      composer.addPass(new OutputPass());
      this.composer = composer;
    }
    this.resize();
  }

  setStoneState(index: number, state: StoneState, animate = true): void {
    if (!this.level || !this.kit) return;
    const mat = this.stoneTops[index];
    const tex = this.kit.faceTexture(this.level.signals[index].symbol, state);
    mat.map = tex;
    if (this.kit.face.glow && mat instanceof THREE.MeshStandardMaterial) mat.emissiveMap = tex;
    mat.needsUpdate = true;
    if (animate) this.pulses.push({ obj: this.stoneMeshes[index], t: 0 });
  }

  /** x/y in tile units (physics coordinates); fall = progress 0..1 of falling, -1 = not falling. */
  updateMarble(x: number, y: number, vx: number, vy: number, dt: number, fall: number): void {
    const lift = fall >= 0 ? -fall * fall * 1.6 : 0;
    const scale = fall >= 0 ? 1 - fall * 0.6 : 1;
    const px = this.kit?.pixelTile;
    if (px) {
      // Snap to the pixel grid for crisp pixel art.
      x = Math.round(x * px) / px;
      y = Math.round(y * px) / px;
    }
    this.marble.position.set(x, MARBLE_RADIUS + lift, y);
    this.marble.scale.setScalar(scale);
    const speed = Math.hypot(vx, vy);
    if (this.marble === this.sphere && speed > 1e-4 && dt > 0) {
      this.tmpAxis.set(vy / speed, 0, -vx / speed);
      this.tmpQ.setFromAxisAngle(this.tmpAxis, (speed * dt) / MARBLE_RADIUS);
      this.marble.quaternion.premultiply(this.tmpQ);
    }
    const off = px ? 1 / px : 0.06;
    this.shadow.position.set(x + off, 0.004, y + off);
    this.shadow.visible = lift > -0.05;
    if (this.followLight) this.followLight.position.set(x, 1.2 + lift, y);
  }

  /** Rubber bands (x1, y1, x2, y2 in tile units) as orange lines just above the floor. */
  updateRubbers(lines: number[]): void {
    if (!lines.length) {
      if (this.bands) this.bands.visible = false;
      return;
    }
    if (!this.bands || this.bands.geometry.getAttribute('position').count !== lines.length / 2) {
      if (this.bands) {
        this.scene.remove(this.bands);
        this.bands.geometry.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((lines.length / 2) * 3), 3));
      this.bands = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf08c14 }));
      this.scene.add(this.bands);
    }
    const pos = this.bands.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lines.length / 2; i++) pos.setXYZ(i, lines[i * 2], MARBLE_RADIUS, lines[i * 2 + 1]);
    pos.needsUpdate = true;
    this.bands.visible = true;
  }

  /** Other actors as spheres: rotors and tops dark red, killers like pearls. */
  updateActors(actors: ActorSprite[]): void {
    while (this.actorMeshes.length < actors.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }));
      this.scene.add(m);
      this.actorMeshes.push(m);
    }
    this.actorMeshes.forEach((m, i) => {
      const a = actors[i];
      m.visible = !!a;
      if (!a) return;
      const r = a.kind === 'marble' ? MARBLE_RADIUS : a.kind === 'rotor' ? 22 / 64 : a.kind === 'top' ? 16 / 64 : 13 / 64;
      const fall = a.fall ?? -1;
      m.scale.setScalar(fall >= 0 ? r * (1 - fall * 0.6) : r);
      m.position.set(a.x, r - (fall >= 0 ? fall * fall * 1.6 : 0), a.y);
      const white = a.kind === 'marble' || a.kind === 'killer' ? a.color !== 0 : false;
      (m.material as THREE.MeshStandardMaterial).color.set(white ? 0xf0f0f0 : a.kind === 'rotor' ? 0x8a1c1c : a.kind === 'top' ? 0xb06a10 : 0x202020);
    });
  }

  render(dt: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const k = Math.min(p.t / 0.25, 1);
      p.obj.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.08);
      if (k >= 1) this.pulses.splice(i, 1);
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Lower the resolution when frames get slow (adaptive quality). */
  setPixelRatio(pr: number): void {
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pixelTile = this.kit?.pixelTile ?? null;
    if (pixelTile && this.level) {
      this.resizePixel(w, h, pixelTile, this.level);
      return;
    }
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(w, h);
    this.perspective.aspect = w / h;
    if (this.level) {
      const halfH = (this.level.height / 2) * 1.08 + 0.4;
      const halfW = ((this.level.width / 2) * 1.04 + 0.4) / this.perspective.aspect;
      const dist = Math.max(halfH, halfW) / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      const center = new THREE.Vector3(this.level.width / 2, 0, this.level.height / 2);
      this.perspective.position.copy(center).addScaledVector(CAM_DIR, dist);
      this.perspective.lookAt(center);
    }
    this.perspective.updateProjectionMatrix();
  }

  /** Flat top-down view with integer upscaling: every tile is exactly `tile` buffer pixels. */
  private resizePixel(w: number, h: number, tile: number, level: Level): void {
    const needW = (level.width + 0.5) * tile;
    const needH = (level.height + 0.5) * tile;
    const fit = Math.min(w / needW, h / needH);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    this.renderer.setPixelRatio(1 / scale);
    this.renderer.setSize(w, h, false);
    const bufW = this.renderer.domElement.width;
    const bufH = this.renderer.domElement.height;
    const halfW = bufW / tile / 2;
    const halfH = bufH / tile / 2;
    const cx = Math.round((level.width / 2) * tile) / tile;
    const cz = Math.round((level.height / 2) * tile) / tile;
    const o = this.ortho;
    o.left = -halfW;
    o.right = halfW;
    o.top = halfH;
    o.bottom = -halfH;
    o.position.set(cx, 50, cz);
    o.up.set(0, 0, -1);
    o.lookAt(cx, 0, cz);
    o.updateProjectionMatrix();
  }

  private clear(): void {
    this.scene.remove(this.sphere, this.sprite, this.shadow);
    this.scene.traverse((o) => {
      if (o === this.sphere || o === this.sprite || o === this.shadow) return;
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (o instanceof THREE.Mesh && o.parent && this.stoneTops.includes(o.material as THREE.MeshBasicMaterial)) {
        (o.material as THREE.Material).dispose();
      }
    });
    this.composer?.dispose();
    this.composer = null;
    this.kit?.dispose();
    this.kit = null;
    this.pulses = [];
    for (const m of this.actorMeshes) (m.material as THREE.Material).dispose();
    this.actorMeshes = []; // geometries were disposed above, meshes are rebuilt on demand
    if (this.bands) (this.bands.material as THREE.Material).dispose();
    this.bands = null;
  }
}

function isWall(level: Level, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= level.width || r >= level.height) return false;
  const s = level.cells[r * level.width + c].stone;
  return s !== null && s !== 'st_oxyd';
}

function hash(c: number, r: number): number {
  const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
