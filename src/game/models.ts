import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EnemyType } from './config';

export interface PlayerMechRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  weaponPivot: THREE.Group;
  muzzleFlash: THREE.Mesh;
  shieldDome: THREE.Mesh;
  armorMaterials: THREE.MeshStandardMaterial[];
}

export interface BossRig {
  root: THREE.Group;
  coreMesh: THREE.Mesh;
  innerRing: THREE.Mesh;
  outerRing: THREE.Group;
  telegraphRing: THREE.Mesh;
  telegraphFill: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
}

function createExtrudedHullGeometry(
  width: number,
  length: number,
  depth: number,
  bevel = 0.08
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = width * 0.5;
  const hl = length * 0.5;
  const cut = Math.min(hw, hl) * 0.35;

  shape.moveTo(-hw + cut, -hl);
  shape.lineTo(hw - cut, -hl);
  shape.lineTo(hw, -hl + cut);
  shape.lineTo(hw, hl - cut);
  shape.lineTo(hw - cut, hl);
  shape.lineTo(-hw + cut, hl);
  shape.lineTo(-hw, hl - cut);
  shape.lineTo(-hw, -hl + cut);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateX(Math.PI * 0.5);
  return geo;
}

export function createPlayerMech(
  contactShadowTex: THREE.Texture,
  castShadow: boolean
): PlayerMechRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = 0.85;
  root.add(bodyGroup);

  // Materials with >= 0.25 roughness contrast
  const primaryArmorMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.65,
    metalness: 0.35,
  });
  const darkFrameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.35,
    metalness: 0.82,
  });
  const cyanVisorMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x00f0ff,
    emissiveIntensity: 1.8,
    roughness: 0.12,
    metalness: 0.9,
  });
  const accentAmberMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.8,
    roughness: 0.3,
    metalness: 0.6,
  });

  // 1. Contact shadow disc at ground level
  const shadowPlane = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 24),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
  );
  shadowPlane.rotation.x = -Math.PI * 0.5;
  shadowPlane.position.y = 0.018;
  root.add(shadowPlane);

  // 2. Pelvis core
  const pelvis = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.3, 0.28, 8),
    darkFrameMat
  );
  pelvis.position.y = -0.18;
  pelvis.castShadow = castShadow;
  bodyGroup.add(pelvis);

  // 3. Left & Right Articulated Legs
  const legGeo = new THREE.CapsuleGeometry(0.14, 0.42, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, darkFrameMat);
  leftLeg.position.set(-0.24, -0.45, 0);
  leftLeg.castShadow = castShadow;
  bodyGroup.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, darkFrameMat);
  rightLeg.position.set(0.24, -0.45, 0);
  rightLeg.castShadow = castShadow;
  bodyGroup.add(rightLeg);

  // 4. Primary Extruded Chest Hull
  const torsoGeo = createExtrudedHullGeometry(0.82, 0.64, 0.55, 0.07);
  const torso = new THREE.Mesh(torsoGeo, primaryArmorMat);
  torso.position.y = 0.22;
  torso.castShadow = castShadow;
  torso.receiveShadow = true;
  bodyGroup.add(torso);

  // 5. Chest Reactor Core Accent
  const chestCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16, 0),
    cyanVisorMat
  );
  chestCore.position.set(0, 0.24, -0.34);
  bodyGroup.add(chestCore);

  // 6. Shoulder Pauldrons (Secondary silhouette)
  const pauldronGeo = createExtrudedHullGeometry(0.34, 0.48, 0.26, 0.05);
  const leftPauldron = new THREE.Mesh(pauldronGeo, primaryArmorMat);
  leftPauldron.position.set(-0.56, 0.42, 0);
  leftPauldron.rotation.z = 0.22;
  leftPauldron.castShadow = castShadow;
  bodyGroup.add(leftPauldron);

  const rightPauldron = new THREE.Mesh(pauldronGeo, primaryArmorMat);
  rightPauldron.position.set(0.56, 0.42, 0);
  rightPauldron.rotation.z = -0.22;
  rightPauldron.castShadow = castShadow;
  bodyGroup.add(rightPauldron);

  // 7. Rear Dual Thruster Pack
  const jetpack = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.44, 0.26),
    darkFrameMat
  );
  jetpack.position.set(0, 0.28, 0.38);
  jetpack.castShadow = castShadow;
  bodyGroup.add(jetpack);

  const thrusterNozzleGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.16, 8);
  const nozzleL = new THREE.Mesh(thrusterNozzleGeo, accentAmberMat);
  nozzleL.position.set(-0.15, 0.12, 0.48);
  nozzleL.rotation.x = -0.35;
  bodyGroup.add(nozzleL);

  const nozzleR = new THREE.Mesh(thrusterNozzleGeo, accentAmberMat);
  nozzleR.position.set(0.15, 0.12, 0.48);
  nozzleR.rotation.x = -0.35;
  bodyGroup.add(nozzleR);

  // 8. Head Pod + Glossy Cyan Visor
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.68, -0.04);
  bodyGroup.add(headGroup);

  const helmet = new THREE.Mesh(
    createExtrudedHullGeometry(0.42, 0.46, 0.28, 0.05),
    primaryArmorMat
  );
  helmet.castShadow = castShadow;
  headGroup.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.12, 0.28),
    cyanVisorMat
  );
  visor.position.set(0, 0.02, -0.14);
  headGroup.add(visor);

  // 9. Twin-Barrel Pulse Rifle (Weapon Pivot on Right Flank)
  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.58, 0.18, -0.15);
  bodyGroup.add(weaponPivot);

  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.24, 0.78),
    darkFrameMat
  );
  gunBody.position.set(0, 0, -0.25);
  gunBody.castShadow = castShadow;
  weaponPivot.add(gunBody);

  const barrelGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.65, 8);
  barrelGeo.rotateX(Math.PI * 0.5);
  const barrel1 = new THREE.Mesh(barrelGeo, primaryArmorMat);
  barrel1.position.set(-0.05, 0.04, -0.58);
  weaponPivot.add(barrel1);

  const barrel2 = new THREE.Mesh(barrelGeo, primaryArmorMat);
  barrel2.position.set(0.05, 0.04, -0.58);
  weaponPivot.add(barrel2);

  const gunRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.06, 0.62),
    cyanVisorMat
  );
  gunRail.position.set(0, 0.12, -0.36);
  weaponPivot.add(gunRail);

  const muzzleFlash = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22, 0),
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.0,
    })
  );
  muzzleFlash.position.set(0, 0.04, -0.98);
  weaponPivot.add(muzzleFlash);

  // 10. Energy Shield Dome (visible when Shield pickup is active)
  const shieldDome = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.38, 2),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  shieldDome.position.y = 0.95;
  shieldDome.visible = false;
  root.add(shieldDome);

  return {
    root,
    bodyGroup,
    headGroup,
    leftLeg,
    rightLeg,
    weaponPivot,
    muzzleFlash,
    shieldDome,
    armorMaterials: [primaryArmorMat, darkFrameMat, cyanVisorMat, accentAmberMat],
  };
}

export function createCompanionDroneMesh(): THREE.Group {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.26, 0),
    new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x9333ea,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.8,
    })
  );
  group.add(core);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.045, 6, 16),
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.5,
      metalness: 0.7,
    })
  );
  ring.rotation.x = Math.PI * 0.5;
  group.add(ring);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.36, 6),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.0,
      roughness: 0.25,
      metalness: 0.8,
    })
  );
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.z = -0.28;
  group.add(barrel);

  return group;
}

export function createBossRig(
  contactShadowTex: THREE.Texture,
  castShadow: boolean
): BossRig {
  const root = new THREE.Group();

  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 32),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    })
  );
  shadowDisc.rotation.x = -Math.PI * 0.5;
  shadowDisc.position.y = 0.02;
  root.add(shadowDisc);

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1e1b4b,
    roughness: 0.55,
    metalness: 0.75,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xff1e56,
    emissiveIntensity: 2.0,
    roughness: 0.18,
    metalness: 0.4,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.85,
  });

  // 1. Primary Armored Octagonal Core
  const coreMesh = new THREE.Mesh(
    createExtrudedHullGeometry(2.8, 2.8, 1.8, 0.18),
    hullMat
  );
  coreMesh.position.y = 2.0;
  coreMesh.castShadow = castShadow;
  coreMesh.receiveShadow = true;
  root.add(coreMesh);

  // 2. Glowing Reactor Heart
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), coreMat);
  heart.position.y = 2.0;
  root.add(heart);

  // 3. Upper Command Crown
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 0.9, 6),
    trimMat
  );
  crown.position.y = 3.35;
  crown.castShadow = castShadow;
  root.add(crown);

  // 4. Inner Rotating Containment Torus
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.05, 0.14, 8, 24),
    coreMat
  );
  innerRing.position.y = 2.0;
  innerRing.rotation.x = Math.PI * 0.5;
  root.add(innerRing);

  // 5. Outer Shield & Quad Cannon Ring
  const outerRing = new THREE.Group();
  outerRing.position.y = 1.9;
  root.add(outerRing);

  const shieldSegmentGeo = new THREE.BoxGeometry(0.95, 1.35, 0.28);
  const cannonGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 8);
  cannonGeo.rotateX(Math.PI * 0.5);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const arm = new THREE.Group();
    arm.rotation.y = angle;

    const shieldPlate = new THREE.Mesh(shieldSegmentGeo, hullMat);
    shieldPlate.position.set(0, 0, -2.55);
    shieldPlate.castShadow = castShadow;
    arm.add(shieldPlate);

    const cannon = new THREE.Mesh(cannonGeo, trimMat);
    cannon.position.set(0, -0.1, -2.85);
    arm.add(cannon);

    outerRing.add(arm);
  }

  // 6. Ground Slam Telegraph Ring & Fill
  const telegraphRing = new THREE.Mesh(
    new THREE.RingGeometry(8.6, 9.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff1e56,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  telegraphRing.rotation.x = -Math.PI * 0.5;
  telegraphRing.position.y = 0.04;
  telegraphRing.visible = false;
  root.add(telegraphRing);

  const telegraphFill = new THREE.Mesh(
    new THREE.CircleGeometry(9.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    })
  );
  telegraphFill.rotation.x = -Math.PI * 0.5;
  telegraphFill.position.y = 0.035;
  telegraphFill.visible = false;
  root.add(telegraphFill);

  root.visible = false;

  return {
    root,
    coreMesh,
    innerRing,
    outerRing,
    telegraphRing,
    telegraphFill,
    materials: [hullMat, coreMat, trimMat],
  };
}

function mergePartsSafe(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((g) => {
    const nonIdx = g.index ? g.toNonIndexed() : g.clone();
    nonIdx.computeVertexNormals();
    // Keep only position and normal so all primitives share identical attributes
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', nonIdx.getAttribute('position'));
    clean.setAttribute('normal', nonIdx.getAttribute('normal'));
    return clean;
  });
  const merged = mergeGeometries(normalized, false);
  if (!merged) {
    return new THREE.BoxGeometry(1, 1, 1);
  }
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds composite multi-part geometries for each enemy archetype so InstancedMesh
 * renders distinctive 3-5 part silhouettes in a single draw call per type.
 */
export function createEnemyArchetypeGeometry(type: EnemyType): THREE.BufferGeometry {
  switch (type) {
    case 'chaser': {
      // Swept interceptor hull + twin side blades + dorsal fin
      const hull = new THREE.ConeGeometry(0.55, 1.35, 6);
      hull.rotateX(-Math.PI * 0.5);
      hull.translate(0, 0.75, 0);

      const wingL = new THREE.BoxGeometry(0.65, 0.08, 0.55);
      wingL.rotateY(0.35);
      wingL.translate(-0.42, 0.72, 0.15);

      const wingR = new THREE.BoxGeometry(0.65, 0.08, 0.55);
      wingR.rotateY(-0.35);
      wingR.translate(0.42, 0.72, 0.15);

      const fin = new THREE.BoxGeometry(0.1, 0.42, 0.5);
      fin.translate(0, 1.0, 0.2);

      return mergePartsSafe([hull, wingL, wingR, fin]);
    }

    case 'tank': {
      // Heavy juggernaut hull + twin armored treads + top mortar turret
      const chassis = createExtrudedHullGeometry(1.6, 1.75, 0.95, 0.1);
      chassis.translate(0, 0.9, 0);

      const treadL = new THREE.BoxGeometry(0.38, 0.55, 1.95);
      treadL.translate(-0.88, 0.45, 0);

      const treadR = new THREE.BoxGeometry(0.38, 0.55, 1.95);
      treadR.translate(0.88, 0.45, 0);

      const turret = new THREE.CylinderGeometry(0.52, 0.65, 0.48, 8);
      turret.translate(0, 1.6, 0.1);

      return mergePartsSafe([chassis, treadL, treadR, turret]);
    }

    case 'shooter': {
      // Artillery hover core + tri-wing stabilizers + forward sniper rail
      const core = new THREE.OctahedronGeometry(0.62, 0);
      core.translate(0, 1.05, 0);

      const ring = new THREE.TorusGeometry(0.78, 0.09, 6, 16);
      ring.rotateX(Math.PI * 0.5);
      ring.translate(0, 1.05, 0);

      const barrel = new THREE.CylinderGeometry(0.1, 0.14, 1.1, 8);
      barrel.rotateX(Math.PI * 0.5);
      barrel.translate(0, 1.05, -0.62);

      return mergePartsSafe([core, ring, barrel]);
    }

    case 'splitter': {
      // Crystalline mitosis prism + dual intersecting containment rings
      const crystal = new THREE.IcosahedronGeometry(0.75, 0);
      crystal.translate(0, 1.1, 0);

      const ring1 = new THREE.TorusGeometry(0.92, 0.08, 6, 18);
      ring1.rotateY(Math.PI * 0.25);
      ring1.translate(0, 1.1, 0);

      const ring2 = new THREE.TorusGeometry(0.92, 0.08, 6, 18);
      ring2.rotateX(Math.PI * 0.35);
      ring2.translate(0, 1.1, 0);

      return mergePartsSafe([crystal, ring1, ring2]);
    }

    case 'splitter_mini': {
      const shard1 = new THREE.OctahedronGeometry(0.44, 0);
      shard1.translate(0, 0.65, 0);
      const shard2 = new THREE.BoxGeometry(0.65, 0.15, 0.65);
      shard2.translate(0, 0.65, 0);
      return mergePartsSafe([shard1, shard2]);
    }

    case 'dasher': {
      // Aggressive horned striker spearhead + twin rear thrusters
      const spear = new THREE.ConeGeometry(0.58, 1.65, 4);
      spear.rotateX(-Math.PI * 0.5);
      spear.translate(0, 0.85, -0.1);

      const hornL = new THREE.ConeGeometry(0.18, 0.95, 4);
      hornL.rotateX(-Math.PI * 0.5);
      hornL.translate(-0.52, 0.85, -0.25);

      const hornR = new THREE.ConeGeometry(0.18, 0.95, 4);
      hornR.rotateX(-Math.PI * 0.5);
      hornR.translate(0.52, 0.85, -0.25);

      const booster = new THREE.CylinderGeometry(0.32, 0.42, 0.5, 6);
      booster.rotateX(Math.PI * 0.5);
      booster.translate(0, 0.85, 0.68);

      return mergePartsSafe([spear, hornL, hornR, booster]);
    }
  }
}
