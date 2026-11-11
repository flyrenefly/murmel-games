import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { marbleSwirl, neonTile, stoneGrain, type FaceStyle } from './textures';

// A theme is only looks: materials, lights, background and post effects.
// Game rules and physics never depend on it.

export type ThemeId = 'glas' | 'neon';

export interface ThemeKit {
  id: ThemeId;
  label: string;
  background: THREE.Color;
  floor: THREE.Material;
  floorTint: (rand: number) => THREE.Color | null;
  wall: THREE.Material;
  wallEdges: THREE.LineBasicMaterial | null;
  stoneBody: THREE.Material;
  marble: THREE.Material;
  abyss: THREE.Material;
  face: FaceStyle;
  bloom: { strength: number; radius: number; threshold: number } | null;
  shadowOpacity: number;
  /** Adds lights; returns a light that follows the marble, if any. */
  addLights(scene: THREE.Scene, renderer: THREE.WebGLRenderer): THREE.PointLight | null;
  dispose(): void;
}

export const THEME_ORDER: ThemeId[] = ['glas', 'neon'];

export function createTheme(id: ThemeId): ThemeKit {
  return id === 'glas' ? glas() : neon();
}

function glas(): ThemeKit {
  const grain = stoneGrain();
  const swirl = marbleSwirl('#1f6fd1', '#e9f3ff');
  let envTarget: THREE.WebGLRenderTarget | null = null;
  const kit: ThemeKit = {
    id: 'glas',
    label: 'Glas und Stein',
    background: new THREE.Color('#cfd6de'),
    floor: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.55, metalness: 0 }),
    floorTint: (r) => new THREE.Color().setHSL(0.09, 0.08, 0.86 + r * 0.1),
    wall: new THREE.MeshStandardMaterial({ color: '#77736d', roughness: 0.8 }),
    wallEdges: null,
    stoneBody: new THREE.MeshStandardMaterial({ color: '#5d6670', roughness: 0.5, metalness: 0.1 }),
    marble: new THREE.MeshPhysicalMaterial({
      map: swirl,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.3,
    }),
    abyss: new THREE.MeshBasicMaterial({ color: '#2a3038' }),
    face: { background: '#3e454d', border: '#59626c', closedMark: '#6c7680', glow: false },
    bloom: null,
    shadowOpacity: 0.9,
    addLights(scene, renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
      pmrem.dispose();
      scene.environment = envTarget.texture;
      scene.add(new THREE.HemisphereLight('#ffffff', '#b9a98f', 1.1));
      const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
      sun.position.set(-4, 10, -3);
      scene.add(sun);
      return null;
    },
    dispose() {
      grain.dispose();
      swirl.dispose();
      envTarget?.dispose();
      for (const m of [kit.floor, kit.wall, kit.stoneBody, kit.marble, kit.abyss]) m.dispose();
    },
  };
  return kit;
}

function neon(): ThemeKit {
  const tile = neonTile('#22e6ff');
  const swirl = marbleSwirl('#3a0030', '#ff3bd4');
  const kit: ThemeKit = {
    id: 'neon',
    label: 'Retro-modern',
    background: new THREE.Color('#05050c'),
    floor: new THREE.MeshStandardMaterial({
      color: '#0b0d18',
      roughness: 0.35,
      metalness: 0.4,
      emissive: '#ffffff',
      emissiveMap: tile,
      emissiveIntensity: 0.55,
    }),
    floorTint: () => null,
    wall: new THREE.MeshStandardMaterial({ color: '#10122a', roughness: 0.4, metalness: 0.3 }),
    wallEdges: new THREE.LineBasicMaterial({ color: '#ff3bd4' }),
    stoneBody: new THREE.MeshStandardMaterial({ color: '#141836', roughness: 0.4, metalness: 0.3, emissive: '#1b2a6b', emissiveIntensity: 0.4 }),
    marble: new THREE.MeshStandardMaterial({
      map: swirl,
      emissive: '#ffffff',
      emissiveMap: swirl,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.2,
    }),
    abyss: new THREE.MeshBasicMaterial({ color: '#000000' }),
    face: { background: '#070a18', border: '#22e6ff', closedMark: '#1d3a66', glow: true },
    bloom: { strength: 0.9, radius: 0.45, threshold: 0.15 },
    shadowOpacity: 0.6,
    addLights(scene) {
      scene.environment = null;
      scene.add(new THREE.AmbientLight('#6f6fff', 0.5));
      const glow = new THREE.PointLight('#ff3bd4', 6, 5, 1.6);
      scene.add(glow);
      return glow;
    },
    dispose() {
      tile.dispose();
      swirl.dispose();
      kit.wallEdges?.dispose();
      for (const m of [kit.floor, kit.wall, kit.stoneBody, kit.marble, kit.abyss]) m.dispose();
    },
  };
  return kit;
}
