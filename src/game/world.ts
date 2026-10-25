import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config';
import { ObstacleCircle } from './rules';
import {
  FloorTextureSet,
  createArenaFloorTextures,
  createNebulaTexture,
} from './textures';

export interface WorldArena {
  group: THREE.Group;
  obstacles: ObstacleCircle[];
  cameraBlockers: THREE.Object3D[];
  dirLight: THREE.DirectionalLight;
  pointLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[];
  starField: THREE.Points;
  floorTextures: FloorTextureSet;
  dispose: () => void;
}

export function buildWorldArena(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  enableShadows: boolean,
  shadowMapSize: number
): WorldArena {
  const group = new THREE.Group();
  scene.add(group);

  const bgColor = new THREE.Color(0x05070e);
  scene.background = bgColor;
  scene.fog = new THREE.FogExp2(0x05070e, 0.011);

  // Studio Environment Map (RoomEnvironment + PMREMGenerator)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmremGenerator.dispose();

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const floorTextures = createArenaFloorTextures(maxAnisotropy);

  // 1. Lighting Rig: Warm Key Directional + Cool Hemisphere + 4 Flickering Point Lights
  const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x090d16, 1.15);
  hemiLight.position.set(0, 40, 0);
  group.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
  dirLight.position.set(14, 28, 16);
  dirLight.castShadow = enableShadows;
  dirLight.shadow.mapSize.width = shadowMapSize;
  dirLight.shadow.mapSize.height = shadowMapSize;
  const d = 22;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  dirLight.shadow.camera.near = 2;
  dirLight.shadow.camera.far = 65;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.02;
  group.add(dirLight);
  group.add(dirLight.target);

  // 2. Reflective Metallic Neon Grid Floor
  const floorGeo = new THREE.CircleGeometry(CONFIG.ARENA.PLAYABLE_RADIUS, 64);
  floorGeo.rotateX(-Math.PI * 0.5);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTextures.albedoMap,
    emissive: 0x38bdf8,
    emissiveMap: floorTextures.emissiveMap,
    emissiveIntensity: 0.95,
    roughnessMap: floorTextures.roughnessMap,
    roughness: 0.45,
    metalness: 0.78,
    bumpMap: floorTextures.bumpMap,
    bumpScale: 0.03,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Outer Abyssal Sub-Terrain (extends beyond playable zone into horizon fog)
  const outerGroundGeo = new THREE.RingGeometry(
    CONFIG.ARENA.PLAYABLE_RADIUS - 0.2,
    135,
    64
  );
  outerGroundGeo.rotateX(-Math.PI * 0.5);
  const outerGroundMat = new THREE.MeshStandardMaterial({
    color: 0x070a14,
    roughness: 0.88,
    metalness: 0.22,
  });
  const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
  outerGround.position.y = -1.6;
  group.add(outerGround);

  // Playable Arena Rim Bevel Ring
  const rimGeo = new THREE.TorusGeometry(CONFIG.ARENA.PLAYABLE_RADIUS, 0.45, 8, 64);
  rimGeo.rotateX(Math.PI * 0.5);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.1,
    roughness: 0.25,
    metalness: 0.85,
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.position.y = 0.1;
  group.add(rimMesh);

  // 3. Natural Outer Basalt/Obsidian Cliff Outcrops (InstancedMesh, 42 outcrops)
  const cliffCount = 42;
  const cliffGeo = new THREE.ConeGeometry(4.5, 16, 6);
  const cliffMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.82,
    metalness: 0.18,
  });
  const cliffInstanced = new THREE.InstancedMesh(cliffGeo, cliffMat, cliffCount);
  const dummy = new THREE.Object3D();
  const cliffColor = new THREE.Color();
  for (let i = 0; i < cliffCount; i++) {
    const angle = (i / cliffCount) * Math.PI * 2 + (i % 3) * 0.04;
    const dist = CONFIG.ARENA.OUTER_CLIFF_RADIUS + (i % 4) * 4.5;
    const scaleY = 0.75 + ((i * 7) % 10) * 0.09;
    const scaleXZ = 0.85 + ((i * 5) % 8) * 0.08;
    dummy.position.set(
      Math.cos(angle) * dist,
      scaleY * 6.0 - 2.5,
      Math.sin(angle) * dist
    );
    dummy.rotation.set(
      ((i % 3) - 1) * 0.12,
      angle + i * 0.5,
      ((i % 2) - 0.5) * 0.1
    );
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    cliffInstanced.setMatrixAt(i, dummy.matrix);

    cliffColor.setHSL(0.6, 0.35, 0.08 + (i % 4) * 0.02);
    cliffInstanced.setColorAt(i, cliffColor);
  }
  cliffInstanced.instanceMatrix.needsUpdate = true;
  if (cliffInstanced.instanceColor) cliffInstanced.instanceColor.needsUpdate = true;
  cliffInstanced.computeBoundingSphere();
  group.add(cliffInstanced);

  // 4. Perimeter Energy Pylons & Laser Barrier Beams (12 pylons around playable edge)
  const pylonCount = 12;
  const pylonBodyGeo = new THREE.CylinderGeometry(0.55, 0.85, 5.2, 6);
  const pylonCapGeo = new THREE.OctahedronGeometry(0.65, 0);
  const pylonBodyMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.45,
    metalness: 0.8,
  });
  const pylonGlowMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.6,
    roughness: 0.15,
    metalness: 0.5,
  });

  for (let i = 0; i < pylonCount; i++) {
    const a1 = (i / pylonCount) * Math.PI * 2;
    const a2 = ((i + 1) / pylonCount) * Math.PI * 2;
    const r = CONFIG.ARENA.PLAYABLE_RADIUS + 0.3;
    const x1 = Math.cos(a1) * r;
    const z1 = Math.sin(a1) * r;
    const x2 = Math.cos(a2) * r;
    const z2 = Math.sin(a2) * r;

    const pylonGroup = new THREE.Group();
    pylonGroup.position.set(x1, 0, z1);

    const body = new THREE.Mesh(pylonBodyGeo, pylonBodyMat);
    body.position.y = 2.6;
    pylonGroup.add(body);

    const cap = new THREE.Mesh(pylonCapGeo, pylonGlowMat);
    cap.position.y = 5.6;
    pylonGroup.add(cap);

    // Horizontal energy beam connecting to next pylon
    const dx = x2 - x1;
    const dz = z2 - z1;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, segLen, 6);
    beamGeo.rotateZ(Math.PI * 0.5);
    const beam = new THREE.Mesh(beamGeo, pylonGlowMat);
    beam.position.set((x1 + x2) * 0.5, 1.6, (z1 + z2) * 0.5);
    beam.rotation.y = -Math.atan2(dz, dx);
    group.add(beam);

    group.add(pylonGroup);
  }

  // 5. Interior Tactical Neon Pillars (8 composite pillars + base crates)
  const obstacles: ObstacleCircle[] = [];
  const cameraBlockers: THREE.Object3D[] = [];

  const pillarBaseGeo = new THREE.CylinderGeometry(
    CONFIG.ARENA.PILLAR_RADIUS,
    CONFIG.ARENA.PILLAR_RADIUS * 1.15,
    0.7,
    8
  );
  const pillarShaftGeo = new THREE.CylinderGeometry(
    CONFIG.ARENA.PILLAR_RADIUS * 0.78,
    CONFIG.ARENA.PILLAR_RADIUS * 0.86,
    5.4,
    8
  );
  const pillarRingGeo = new THREE.TorusGeometry(
    CONFIG.ARENA.PILLAR_RADIUS * 0.88,
    0.12,
    8,
    24
  );
  pillarRingGeo.rotateX(Math.PI * 0.5);

  const crateGeo = new THREE.BoxGeometry(0.65, 0.65, 0.65);
  const pillarDarkMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.55,
    metalness: 0.72,
  });
  const pillarAccentMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.6,
  });

  for (let i = 0; i < CONFIG.ARENA.PILLAR_COUNT; i++) {
    const angle = (i / CONFIG.ARENA.PILLAR_COUNT) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(angle) * CONFIG.ARENA.PILLAR_RING_RADIUS;
    const pz = Math.sin(angle) * CONFIG.ARENA.PILLAR_RING_RADIUS;

    obstacles.push({
      x: px,
      z: pz,
      radius: CONFIG.ARENA.PILLAR_RADIUS,
    });

    const pGroup = new THREE.Group();
    pGroup.position.set(px, 0, pz);

    const base = new THREE.Mesh(pillarBaseGeo, pillarDarkMat);
    base.position.y = 0.35;
    base.castShadow = enableShadows;
    base.receiveShadow = true;
    pGroup.add(base);

    const shaft = new THREE.Mesh(pillarShaftGeo, pillarDarkMat);
    shaft.position.y = 3.0;
    shaft.castShadow = enableShadows;
    shaft.receiveShadow = true;
    pGroup.add(shaft);
    cameraBlockers.push(shaft);

    const ringLow = new THREE.Mesh(pillarRingGeo, i % 2 === 0 ? pylonGlowMat : pillarAccentMat);
    ringLow.position.y = 1.4;
    pGroup.add(ringLow);

    const ringHigh = new THREE.Mesh(pillarRingGeo, i % 2 === 0 ? pylonGlowMat : pillarAccentMat);
    ringHigh.position.y = 4.6;
    pGroup.add(ringHigh);

    // Clustered supply crate anchored flush against pillar base
    const crate = new THREE.Mesh(crateGeo, pylonBodyMat);
    crate.position.set(
      Math.cos(angle + 0.6) * (CONFIG.ARENA.PILLAR_RADIUS * 0.9),
      0.325,
      Math.sin(angle + 0.6) * (CONFIG.ARENA.PILLAR_RADIUS * 0.9)
    );
    crate.rotation.y = angle * 1.3;
    crate.castShadow = enableShadows;
    pGroup.add(crate);

    group.add(pGroup);
  }

  // 6. Illuminated Energy Platforms + Flickering Point Lights (4 platforms)
  const pointLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];
  const platRingGeo = new THREE.RingGeometry(
    CONFIG.ARENA.PLATFORM_RADIUS - 0.28,
    CONFIG.ARENA.PLATFORM_RADIUS,
    32
  );
  platRingGeo.rotateX(-Math.PI * 0.5);

  const platInnerGeo = new THREE.CircleGeometry(CONFIG.ARENA.PLATFORM_RADIUS - 0.3, 32);
  platInnerGeo.rotateX(-Math.PI * 0.5);

  const platColors = [0x06b6d4, 0xd946ef, 0x06b6d4, 0xf59e0b];

  for (let i = 0; i < CONFIG.ARENA.PLATFORM_COUNT; i++) {
    const angle = (i / CONFIG.ARENA.PLATFORM_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * CONFIG.ARENA.PLATFORM_RING_RADIUS;
    const z = Math.sin(angle) * CONFIG.ARENA.PLATFORM_RING_RADIUS;
    const color = platColors[i % platColors.length];

    const ringMat = new THREE.MeshBasicMaterial({
      color,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const ringMesh = new THREE.Mesh(platRingGeo, ringMat);
    ringMesh.position.set(x, 0.025, z);
    group.add(ringMesh);

    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: color,
      emissiveIntensity: 0.25,
      roughness: 0.2,
      metalness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const innerMesh = new THREE.Mesh(platInnerGeo, innerMat);
    innerMesh.position.set(x, 0.02, z);
    innerMesh.receiveShadow = true;
    group.add(innerMesh);

    const pLight = new THREE.PointLight(color, 3.2, 16, 2);
    pLight.position.set(x, 2.2, z);
    group.add(pLight);
    pointLights.push({
      light: pLight,
      baseIntensity: 3.2,
      phase: i * 1.7,
    });
  }

  // Central Spawn Vista Ring
  const centerRingGeo = new THREE.RingGeometry(3.6, 4.0, 48);
  centerRingGeo.rotateX(-Math.PI * 0.5);
  const centerRing = new THREE.Mesh(
    centerRingGeo,
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  centerRing.position.y = 0.022;
  group.add(centerRing);

  // 7. Procedural Skybox: Starfield (Points) + Soft Nebula Glow Planes
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.46; // Upper hemisphere
    const r = 85 + Math.random() * 45;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.cos(phi) + 6;
    starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    tmpColor.setHSL(0.55 + Math.random() * 0.25, 0.7, 0.7 + Math.random() * 0.3);
    starColors[i * 3] = tmpColor.r;
    starColors[i * 3 + 1] = tmpColor.g;
    starColors[i * 3 + 2] = tmpColor.b;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.55,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    fog: false,
  });
  const starField = new THREE.Points(starGeo, starMat);
  group.add(starField);

  // Nebula glow clouds in the distant sky
  const nebulaColors = ['#0284c7', '#7e22ce', '#be185d'];
  const nebulaTextures: THREE.CanvasTexture[] = [];
  nebulaColors.forEach((hex, idx) => {
    const tex = createNebulaTexture(hex);
    nebulaTextures.push(tex);
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    const angle = (idx / nebulaColors.length) * Math.PI * 2 + 0.4;
    sprite.position.set(Math.cos(angle) * 75, 28 + idx * 8, Math.sin(angle) * 75);
    sprite.scale.set(65, 38, 1);
    group.add(sprite);
  });

  const dispose = () => {
    envTex.dispose();
    floorTextures.albedoMap.dispose();
    floorTextures.emissiveMap.dispose();
    floorTextures.roughnessMap.dispose();
    floorTextures.bumpMap.dispose();
    nebulaTextures.forEach((t) => t.dispose());
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
  };

  return {
    group,
    obstacles,
    cameraBlockers,
    dirLight,
    pointLights,
    starField,
    floorTextures,
    dispose,
  };
}
