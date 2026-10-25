import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CONFIG,
  EnemyType,
  PickupType,
  UpgradeDefinition,
  UpgradeId,
} from './config';
import {
  ComputedPlayerStats,
  SpatialHash2D,
  UpgradeLevels,
  calculateComboMultiplier,
  calculateKillScore,
  computePlayerStats,
  createEmptyUpgradeLevels,
  getWaveConfig,
  pickUpgradeChoices,
  pickWeightedEnemyType,
  resolveCircleObstacleCollision,
  xpRequiredForLevel,
} from './rules';
import { GameSettings } from './storage';
import { SoundEngine } from './audio';
import { createContactShadowTexture } from './textures';
import {
  BossRig,
  PlayerMechRig,
  createBossRig,
  createCompanionDroneMesh,
  createEnemyArchetypeGeometry,
  createPlayerMech,
} from './models';
import { WorldArena, buildWorldArena } from './world';

export type GameStateMode = 'title' | 'playing' | 'levelup' | 'paused' | 'gameover';

export interface HudSnapshot {
  mode: GameStateMode;
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  level: number;
  wave: number;
  waveBannerText: string | null;
  score: number;
  highScore: number;
  comboCount: number;
  comboMultiplier: number;
  comboTimerRatio: number;
  dashCooldownRatio: number; // 1 = ready, 0..1 = recharging
  kills: number;
  elapsedSeconds: number;
  shieldTimer: number;
  slowTimeTimer: number;
  fps: number;
  upgradeChoices: UpgradeDefinition[];
  upgradeLevels: UpgradeLevels;
  tutorialStep: number; // 0 = move, 1 = shoot, 2 = dash, 3 = done
  boss: {
    active: boolean;
    name: string;
    hp: number;
    maxHp: number;
    screenAngleRad: number;
    isOffscreen: boolean;
  };
}

interface EnemyInstance {
  active: boolean;
  id: number;
  type: EnemyType;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  rotY: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  scoreValue: number;
  xpValue: number;
  hitFlashTimer: number;
  koTimer: number; // > 0 when dying (0.25s KO topple/shrink)
  stateTimer: number;
  cooldownTimer: number;
  state: 'seek' | 'telegraph' | 'charge' | 'ko';
  chargeDirX: number;
  chargeDirZ: number;
}

interface ProjectileInstance {
  active: boolean;
  isPlayer: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  damage: number;
  isCrit: boolean;
  life: number;
  pierceLeft: number;
  ricochetLeft: number;
  hitEnemyIds: Set<number>;
}

interface PickupInstance {
  active: boolean;
  type: PickupType;
  x: number;
  z: number;
  vx: number;
  vz: number;
  value: number;
  age: number;
}

interface ParticleInstance {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  age: number;
  maxAge: number;
  r: number;
  g: number;
  b: number;
}

interface ShockwaveInstance {
  active: boolean;
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
  maxRadius: number;
}

interface FloatingTextInstance {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  maxAge: number;
  text: string;
  color: string;
  scale: number;
}

const DamageVignetteChromaticShader = {
  uniforms: {
    tDiffuse: { value: null },
    chromaticAmount: { value: 0.0 },
    vignetteDarkness: { value: 0.48 },
    dangerPulse: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float chromaticAmount;
    uniform float vignetteDarkness;
    uniform float dangerPulse;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - vec2(0.5);
      float dist = length(dir);
      vec2 offset = dir * chromaticAmount * dist;

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      vec3 col = vec3(r, g, b);

      float vig = smoothstep(0.32, 0.88, dist);
      col *= (1.0 - vig * vignetteDarkness);
      col = mix(col, vec3(0.95, 0.08, 0.22), vig * dangerPulse * 0.55);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class NeonSurvivorEngine {
  private container: HTMLElement;
  private floatingTextContainer: HTMLElement;
  private floatingDomPool: HTMLSpanElement[] = [];
  private floatingTexts: FloatingTextInstance[] = [];

  public readonly isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private customFxPass: ShaderPass | null = null;

  private world: WorldArena;
  private contactShadowTex: THREE.CanvasTexture;
  private playerRig: PlayerMechRig;
  private companionDrones: THREE.Group[] = [];
  private bossRig: BossRig;

  private spatialHash: SpatialHash2D;
  private sound: SoundEngine;
  private settings: GameSettings;
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  // Game State
  private mode: GameStateMode = 'title';
  private frameId = 0;
  private disposed = false;
  private lastTimeMs = 0;
  private accumulator = 0;
  private totalSimTime = 0;
  private hitstopTimer = 0;

  // Dynamic resolution & FPS tracking
  private fpsFrameCount = 0;
  private fpsAccumTime = 0;
  private currentFps = 60;
  private dynamicPixelRatio = 1;

  // Player state
  private player = {
    x: 0,
    z: 0,
    prevX: 0,
    prevZ: 0,
    vx: 0,
    vz: 0,
    rotY: 0,
    aimX: 0,
    aimZ: -8,
    hp: 100,
    maxHp: 100,
    xp: 0,
    xpToNext: 50,
    level: 1,
    dashTimer: 0,
    dashCooldownTimer: 0,
    dashDirX: 0,
    dashDirZ: -1,
    iframeTimer: 0,
    fireTimer: 0,
    droneFireTimer: 0,
    walkDist: 0,
    recoilAmount: 0,
    hitFlashTimer: 0,
    shieldTimer: 0,
    slowTimeTimer: 0,
  };

  private upgradeLevels: UpgradeLevels = createEmptyUpgradeLevels();
  private playerStats: ComputedPlayerStats = computePlayerStats(this.upgradeLevels);
  private currentUpgradeChoices: UpgradeDefinition[] = [];

  // Wave & Score State
  private wave = 1;
  private waveIntermissionTimer = 0;
  private waveBannerTimer = 0;
  private waveBannerText: string | null = null;
  private waveEnemiesRemainingToSpawn = 0;
  private waveSpawnTimer = 0;
  private score = 0;
  private highScore = 0;
  private kills = 0;
  private comboCount = 0;
  private comboTimer = 0;

  // Tutorial state (0 = move, 1 = shoot, 2 = dash, 3 = complete)
  private tutorialStep = 0;
  private tutorialMoveAccum = 0;
  private tutorialShotCount = 0;

  // Boss state
  private boss = {
    active: false,
    x: 0,
    z: -18,
    vx: 0,
    vz: 0,
    hp: 1400,
    maxHp: 1400,
    phase: 0, // 0 = radial, 1 = summon, 2 = slam
    phaseTimer: 3.0,
    slamTelegraphTimer: 0,
    hitFlashTimer: 0,
  };

  // Camera rig state
  private camState = {
    x: 0,
    y: CONFIG.CAMERA.OFFSET_Y,
    z: CONFIG.CAMERA.OFFSET_Z,
    lookX: 0,
    lookZ: 0,
    trauma: 0,
    chromaticPulse: 0,
    fov: CONFIG.CAMERA.BASE_FOV,
    tiltZ: 0,
    titleAngle: 0,
  };

  // Input state
  private keysHeld = new Set<string>();
  private keysJustPressed = new Set<string>();
  private mouseDown = false;
  private pointerNdc = new THREE.Vector2(0, 0);
  private pointerActive = false;
  private mobileMoveVec = new THREE.Vector2(0, 0);
  private mobileAutoFire = false;

  // Object Pools & InstancedMeshes
  private enemies: EnemyInstance[] = [];
  private nextEnemyId = 1;
  private enemyInstancedMeshes!: Record<EnemyType, THREE.InstancedMesh>;
  private dasherTelegraphMeshes: THREE.Mesh[] = [];

  private projectiles: ProjectileInstance[] = [];
  private playerBulletInstanced!: THREE.InstancedMesh;
  private enemyBulletInstanced!: THREE.InstancedMesh;

  private pickups: PickupInstance[] = [];
  private pickupInstanced!: THREE.InstancedMesh;

  private particles: ParticleInstance[] = [];
  private particleInstanced!: THREE.InstancedMesh;

  private shockwaves: ShockwaveInstance[] = [];

  // Pre-allocated math scratch objects (Zero-GC in hot loop)
  private readonly _dummy = new THREE.Object3D();
  private readonly _color = new THREE.Color();
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _intersectPt = new THREE.Vector3();
  private readonly _projVec = new THREE.Vector3();
  private readonly _camRayDir = new THREE.Vector3();
  private readonly _camOrigin = new THREE.Vector3();

  private hudSyncCounter = 0;

  constructor(
    container: HTMLElement,
    floatingTextContainer: HTMLElement,
    initialSettings: GameSettings,
    initialHighScore: number,
    tutorialDone: boolean,
    onHudUpdate: (snapshot: HudSnapshot) => void,
    onLoadingProgress?: (progress: number) => void
  ) {
    this.container = container;
    this.floatingTextContainer = floatingTextContainer;
    this.settings = { ...initialSettings };
    this.highScore = initialHighScore;
    this.tutorialStep = tutorialDone ? 3 : 0;
    this.onHudUpdate = onHudUpdate;

    onLoadingProgress?.(15);
    this.isSoftwareGl = detectSoftwareGl();
    this.sound = new SoundEngine(this.settings);
    this.spatialHash = new SpatialHash2D(CONFIG.ARENA.SPATIAL_HASH_CELL_SIZE);

    // 1. WebGLRenderer Setup
    const preset = CONFIG.QUALITY_PRESETS[this.settings.quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.dynamicPixelRatio = this.isSoftwareGl
      ? 1
      : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
    this.renderer.setPixelRatio(this.dynamicPixelRatio);
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    onLoadingProgress?.(40);

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.BASE_FOV,
      (container.clientWidth || window.innerWidth) /
        Math.max(1, container.clientHeight || window.innerHeight),
      0.5,
      190
    );

    // 3. Build Arena World
    this.world = buildWorldArena(
      this.scene,
      this.renderer,
      !this.isSoftwareGl && preset.shadows,
      preset.shadowMapSize
    );
    this.contactShadowTex = createContactShadowTexture();

    onLoadingProgress?.(65);

    // 4. Build Player, Companion Drones, Boss, and Instanced Pools
    this.playerRig = createPlayerMech(
      this.contactShadowTex,
      !this.isSoftwareGl && preset.shadows
    );
    this.scene.add(this.playerRig.root);

    for (let i = 0; i < 4; i++) {
      const drone = createCompanionDroneMesh();
      drone.visible = false;
      this.scene.add(drone);
      this.companionDrones.push(drone);
    }

    this.bossRig = createBossRig(
      this.contactShadowTex,
      !this.isSoftwareGl && preset.shadows
    );
    this.scene.add(this.bossRig.root);

    this.initPoolsAndInstancedMeshes();
    this.initFloatingTextPool();
    this.setupPostProcessing();

    onLoadingProgress?.(90);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.syncBodyStateAttribute();
    this.emitHudSnapshot();

    onLoadingProgress?.(100);
    this.lastTimeMs = performance.now();
    this.scheduleNextFrame();
  }

  private setupPostProcessing(): void {
    if (this.isSoftwareGl) {
      this.composer = null;
      return;
    }
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const preset = CONFIG.QUALITY_PRESETS[this.settings.quality];

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      preset.bloomStrength,
      0.38,
      0.78
    );
    this.bloomPass.enabled = preset.bloom;
    this.composer.addPass(this.bloomPass);

    this.customFxPass = new ShaderPass(DamageVignetteChromaticShader);
    this.composer.addPass(this.customFxPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  private initPoolsAndInstancedMeshes(): void {
    const maxEnemies = CONFIG.WAVE.MAX_ACTIVE_ENEMIES;
    const types: EnemyType[] = [
      'chaser',
      'tank',
      'shooter',
      'splitter',
      'splitter_mini',
      'dasher',
    ];

    const meshes = {} as Record<EnemyType, THREE.InstancedMesh>;
    types.forEach((t) => {
      const cfg = CONFIG.ENEMIES[t];
      const geo = createEnemyArchetypeGeometry(t);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: cfg.emissiveHex,
        emissiveIntensity: 0.65,
        roughness: 0.35,
        metalness: 0.72,
      });
      const im = new THREE.InstancedMesh(geo, mat, maxEnemies);
      im.count = 0;
      im.castShadow = !this.isSoftwareGl && t !== 'splitter_mini';
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.scene.add(im);
      meshes[t] = im;
    });
    this.enemyInstancedMeshes = meshes;

    // Pre-allocate Enemy pool
    for (let i = 0; i < maxEnemies; i++) {
      this.enemies.push({
        active: false,
        id: 0,
        type: 'chaser',
        x: 0,
        z: 0,
        prevX: 0,
        prevZ: 0,
        vx: 0,
        vz: 0,
        rotY: 0,
        hp: 10,
        maxHp: 10,
        speed: 5,
        radius: 0.8,
        contactDamage: 10,
        scoreValue: 10,
        xpValue: 10,
        hitFlashTimer: 0,
        koTimer: 0,
        stateTimer: 0,
        cooldownTimer: 0,
        state: 'seek',
        chargeDirX: 0,
        chargeDirZ: 1,
      });
    }

    // Dasher ground telegraph corridors (16 pooled meshes)
    const teleGeo = new THREE.PlaneGeometry(1.3, 12.0);
    teleGeo.rotateX(-Math.PI * 0.5);
    teleGeo.translate(0, 0, -6.0);
    const teleMat = new THREE.MeshBasicMaterial({
      color: 0xff1e56,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(teleGeo, teleMat);
      m.position.y = 0.035;
      m.visible = false;
      this.scene.add(m);
      this.dasherTelegraphMeshes.push(m);
    }

    // Projectiles Pool (260 max)
    const maxProjectiles = 260;
    for (let i = 0; i < maxProjectiles; i++) {
      this.projectiles.push({
        active: false,
        isPlayer: true,
        x: 0,
        y: 1.0,
        z: 0,
        vx: 0,
        vz: 0,
        radius: 0.25,
        damage: 20,
        isCrit: false,
        life: 0,
        pierceLeft: 0,
        ricochetLeft: 0,
        hitEnemyIds: new Set(),
      });
    }

    const playerBoltGeo = new THREE.CapsuleGeometry(0.11, 0.65, 4, 6);
    playerBoltGeo.rotateX(Math.PI * 0.5);
    const playerBoltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.playerBulletInstanced = new THREE.InstancedMesh(
      playerBoltGeo,
      playerBoltMat,
      maxProjectiles
    );
    this.playerBulletInstanced.count = 0;
    this.playerBulletInstanced.frustumCulled = false;
    this.scene.add(this.playerBulletInstanced);

    const enemyOrbGeo = new THREE.IcosahedronGeometry(0.26, 1);
    const enemyOrbMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    this.enemyBulletInstanced = new THREE.InstancedMesh(
      enemyOrbGeo,
      enemyOrbMat,
      maxProjectiles
    );
    this.enemyBulletInstanced.count = 0;
    this.enemyBulletInstanced.frustumCulled = false;
    this.scene.add(this.enemyBulletInstanced);

    // Pickups & XP Orbs Pool (240 max)
    const maxPickups = 240;
    for (let i = 0; i < maxPickups; i++) {
      this.pickups.push({
        active: false,
        type: 'xp',
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        value: 10,
        age: 0,
      });
    }
    const pickupGeo = new THREE.OctahedronGeometry(0.32, 0);
    const pickupMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.8,
    });
    this.pickupInstanced = new THREE.InstancedMesh(pickupGeo, pickupMat, maxPickups);
    this.pickupInstanced.count = 0;
    this.pickupInstanced.frustumCulled = false;
    this.scene.add(this.pickupInstanced);

    // Pooled Particles Ring Buffer (650 max)
    const maxParticles = 650;
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 0.2,
        age: 0,
        maxAge: 0.5,
        r: 1,
        g: 1,
        b: 1,
      });
    }
    const partGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstanced = new THREE.InstancedMesh(
      partGeo,
      partMat,
      maxParticles
    );
    this.particleInstanced.count = 0;
    this.particleInstanced.frustumCulled = false;
    this.scene.add(this.particleInstanced);

    // Shockwave Rings Pool (10 max)
    const ringGeo = new THREE.RingGeometry(0.75, 1.0, 36);
    ringGeo.rotateX(-Math.PI * 0.5);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.position.y = 0.06;
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({
        active: false,
        mesh,
        age: 0,
        maxAge: 0.45,
        maxRadius: 4.5,
      });
    }
  }

  private initFloatingTextPool(): void {
    this.floatingTextContainer.innerHTML = '';
    this.floatingDomPool = [];
    this.floatingTexts = [];
    const poolSize = 24;

    for (let i = 0; i < poolSize; i++) {
      const span = document.createElement('span');
      span.className =
        'fixed left-0 top-0 pointer-events-none font-display font-bold tracking-wider select-none whitespace-nowrap';
      span.style.opacity = '0';
      span.style.willChange = 'transform, opacity';
      span.style.textShadow = '0 2px 6px rgba(0,0,0,0.95)';
      this.floatingTextContainer.appendChild(span);
      this.floatingDomPool.push(span);

      this.floatingTexts.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        age: 0,
        maxAge: 0.65,
        text: '',
        color: '#ffffff',
        scale: 1,
      });
    }
  }

  private spawnFloatingText(
    x: number,
    y: number,
    z: number,
    text: string,
    color = '#f8fafc',
    scale = 1.0
  ): void {
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) {
        ft.active = true;
        ft.x = x + (Math.random() - 0.5) * 0.6;
        ft.y = y;
        ft.z = z + (Math.random() - 0.5) * 0.6;
        ft.age = 0;
        ft.maxAge = 0.65;
        ft.text = text;
        ft.color = color;
        ft.scale = scale;
        const dom = this.floatingDomPool[i];
        dom.textContent = text;
        dom.style.color = color;
        dom.style.fontSize = `${Math.round(14 * scale)}px`;
        return;
      }
    }
  }

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    colorHex: number,
    speedMin = 3,
    speedMax = 10,
    size = 0.9,
    maxAge = 0.42
  ): void {
    const presetMax = CONFIG.QUALITY_PRESETS[this.settings.quality].maxParticles;
    this._color.setHex(colorHex);
    let spawned = 0;

    for (let i = 0; i < presetMax && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        const angle = Math.random() * Math.PI * 2;
        const spd = speedMin + Math.random() * (speedMax - speedMin);
        p.vx = Math.cos(angle) * spd;
        p.vy = 1.5 + Math.random() * 5.5;
        p.vz = Math.sin(angle) * spd;
        p.size = size * (0.7 + Math.random() * 0.6);
        p.age = 0;
        p.maxAge = maxAge * (0.75 + Math.random() * 0.5);
        p.r = this._color.r;
        p.g = this._color.g;
        p.b = this._color.b;
        spawned++;
      }
    }
  }

  private spawnShockwave(
    x: number,
    z: number,
    maxRadius: number,
    colorHex: number,
    duration = 0.42
  ): void {
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) {
        sw.active = true;
        sw.age = 0;
        sw.maxAge = duration;
        sw.maxRadius = maxRadius;
        sw.mesh.position.set(x, 0.06, z);
        sw.mesh.scale.setScalar(0.2);
        (sw.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
        (sw.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
        sw.mesh.visible = true;
        return;
      }
    }
  }

  private addCameraTrauma(amount: number): void {
    if (!this.settings.screenShake) return;
    this.camState.trauma = Math.min(1.0, this.camState.trauma + amount);
  }

  // Public Lifecycle & State Controls
  public startNewRun(): void {
    this.sound.unlock();
    this.sound.playSfx('uiClick');
    this.sound.startMusic();

    // Reset player & stats
    this.upgradeLevels = createEmptyUpgradeLevels();
    this.playerStats = computePlayerStats(this.upgradeLevels);
    this.currentUpgradeChoices = [];

    this.player.x = 0;
    this.player.z = 6;
    this.player.prevX = 0;
    this.player.prevZ = 6;
    this.player.vx = 0;
    this.player.vz = 0;
    this.player.rotY = 0;
    this.player.aimX = 0;
    this.player.aimZ = -6;
    this.player.hp = this.playerStats.maxHp;
    this.player.maxHp = this.playerStats.maxHp;
    this.player.xp = 0;
    this.player.level = 1;
    this.player.xpToNext = xpRequiredForLevel(1);
    this.player.dashTimer = 0;
    this.player.dashCooldownTimer = 0;
    this.player.iframeTimer = 0.5;
    this.player.fireTimer = 0;
    this.player.droneFireTimer = 0;
    this.player.hitFlashTimer = 0;
    this.player.shieldTimer = 0;
    this.player.slowTimeTimer = 0;

    // Clear entities
    this.enemies.forEach((e) => (e.active = false));
    this.projectiles.forEach((p) => (p.active = false));
    this.pickups.forEach((p) => (p.active = false));
    this.particles.forEach((p) => (p.active = false));
    this.shockwaves.forEach((s) => {
      s.active = false;
      s.mesh.visible = false;
    });
    this.floatingTexts.forEach((ft, i) => {
      ft.active = false;
      if (this.floatingDomPool[i]) this.floatingDomPool[i].style.opacity = '0';
    });

    this.boss.active = false;
    this.bossRig.root.visible = false;

    this.wave = 1;
    this.score = 0;
    this.kills = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.totalSimTime = 0;
    this.hitstopTimer = 0;

    this.keysHeld.clear();
    this.keysJustPressed.clear();
    this.mouseDown = false;

    this.camState.x = this.player.x;
    this.camState.y = CONFIG.CAMERA.OFFSET_Y;
    this.camState.z = this.player.z + CONFIG.CAMERA.OFFSET_Z;
    this.camState.lookX = this.player.x;
    this.camState.lookZ = this.player.z;
    this.camState.trauma = 0;
    this.camState.chromaticPulse = 0;

    this.beginWave(1);
    this.setMode('playing');
  }

  private beginWave(waveNum: number): void {
    this.wave = waveNum;
    this.sound.setWaveIntensity(waveNum);
    const wCfg = getWaveConfig(waveNum);
    this.waveEnemiesRemainingToSpawn = wCfg.totalEnemies;
    this.waveSpawnTimer = 0.4;
    this.waveBannerText = wCfg.isBossWave
      ? `WAVE ${waveNum} · BOSS INCOMING`
      : `WAVE ${waveNum}`;
    this.waveBannerTimer = 2.6;

    if (wCfg.isBossWave) {
      this.spawnBoss(wCfg.bossHp);
    }
  }

  public spawnBoss(bossHp?: number): void {
    const hp = bossHp ?? getWaveConfig(Math.max(5, this.wave)).bossHp;
    this.boss.active = true;
    this.boss.x = 0;
    this.boss.z = -20;
    this.boss.vx = 0;
    this.boss.vz = 0;
    this.boss.hp = hp;
    this.boss.maxHp = hp;
    this.boss.phase = 0;
    this.boss.phaseTimer = 3.2;
    this.boss.slamTelegraphTimer = 0;
    this.boss.hitFlashTimer = 0;
    this.bossRig.root.position.set(this.boss.x, 0, this.boss.z);
    this.bossRig.root.visible = true;
    this.bossRig.telegraphRing.visible = false;
    this.bossRig.telegraphFill.visible = false;
    this.sound.playSfx('bossSpawn', 0, -18);
    this.addCameraTrauma(0.55);
  }

  public selectUpgrade(id: UpgradeId): void {
    if (this.mode !== 'levelup') return;
    this.sound.playSfx('uiClick');

    const prevMaxHp = this.playerStats.maxHp;
    this.upgradeLevels[id] = (this.upgradeLevels[id] ?? 0) + 1;
    this.playerStats = computePlayerStats(this.upgradeLevels);

    if (id === 'max_hp') {
      const gained = this.playerStats.maxHp - prevMaxHp;
      this.player.maxHp = this.playerStats.maxHp;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + gained);
    }

    this.currentUpgradeChoices = [];
    this.setMode('playing');
  }

  public setMode(nextMode: GameStateMode): void {
    this.mode = nextMode;
    this.syncBodyStateAttribute();

    if (nextMode !== 'playing' && document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    if (nextMode === 'paused' || nextMode === 'title' || nextMode === 'gameover') {
      this.keysHeld.clear();
      this.keysJustPressed.clear();
      this.mouseDown = false;
    }
    this.emitHudSnapshot();
  }

  public updateSettings(newSettings: GameSettings): void {
    this.settings = { ...newSettings };
    this.sound.applySettings(this.settings);

    const preset = CONFIG.QUALITY_PRESETS[this.settings.quality];
    this.dynamicPixelRatio = this.isSoftwareGl
      ? 1
      : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
    this.renderer.setPixelRatio(this.dynamicPixelRatio);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && preset.shadows;
    this.world.dirLight.castShadow = !this.isSoftwareGl && preset.shadows;

    if (this.bloomPass) {
      this.bloomPass.enabled = preset.bloom;
      this.bloomPass.strength = preset.bloomStrength;
    }
    this.emitHudSnapshot();
  }

  public setMobileInput(moveX: number, moveY: number, autoFire: boolean): void {
    this.mobileMoveVec.set(moveX, moveY);
    this.mobileAutoFire = autoFire;
  }

  public triggerDash(): void {
    if (this.mode !== 'playing') return;
    this.keysJustPressed.add('Space');
  }

  private syncBodyStateAttribute(): void {
    const mapped = this.mode === 'levelup' ? 'paused' : this.mode;
    document.body.dataset.state = mapped;
  }

  // Fixed-Timestep 60Hz Simulation Step
  private stepSimulation(dt: number): void {
    // Hit-stop freezes simulation physics briefly on heavy impacts while visual flashes decay
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return;
    }

    const timeScale =
      this.player.slowTimeTimer > 0 ? CONFIG.PROGRESSION.SLOW_TIME_FACTOR : 1.0;
    const enemyDt = dt * timeScale;

    this.totalSimTime += dt;

    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);
      if (this.waveBannerTimer === 0) {
        this.waveBannerText = null;
      }
    }

    // Combo decay
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboTimer = 0;
      }
    }

    // Active pickup buffs
    if (this.player.shieldTimer > 0) {
      this.player.shieldTimer = Math.max(0, this.player.shieldTimer - dt);
    }
    if (this.player.slowTimeTimer > 0) {
      this.player.slowTimeTimer = Math.max(0, this.player.slowTimeTimer - dt);
    }

    // Passive HP Regen upgrade
    if (this.playerStats.regenPerSec > 0 && this.player.hp < this.player.maxHp) {
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + this.playerStats.regenPerSec * dt
      );
    }

    this.stepPlayer(dt);
    this.stepWaveSpawner(enemyDt);
    this.stepEnemies(enemyDt);
    this.stepBoss(enemyDt);
    this.stepProjectiles(dt, enemyDt);
    this.stepPickups(dt);
    this.stepParticlesAndShockwaves(dt);
  }

  private stepPlayer(dt: number): void {
    const p = this.player;
    p.prevX = p.x;
    p.prevZ = p.z;

    if (p.dashCooldownTimer > 0) {
      p.dashCooldownTimer = Math.max(0, p.dashCooldownTimer - dt);
    }
    if (p.iframeTimer > 0) {
      p.iframeTimer = Math.max(0, p.iframeTimer - dt);
    }
    if (p.hitFlashTimer > 0) {
      p.hitFlashTimer = Math.max(0, p.hitFlashTimer - dt);
    }
    if (p.recoilAmount > 0) {
      p.recoilAmount = Math.max(0, p.recoilAmount - dt * 6.0);
    }

    // Gather movement input (WASD / Arrows / Virtual Joystick / Optional Gamepad)
    let inputX = this.mobileMoveVec.x;
    let inputZ = this.mobileMoveVec.y;

    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) inputZ -= 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) inputZ += 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) inputX -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) inputX += 1;

    // Optional Gamepad API support
    if (navigator.getGamepads) {
      const pads = navigator.getGamepads();
      const pad = pads && pads[0];
      if (pad) {
        if (Math.abs(pad.axes[0]) > 0.18) inputX += pad.axes[0];
        if (Math.abs(pad.axes[1]) > 0.18) inputZ += pad.axes[1];
        if (pad.buttons[0]?.pressed && p.dashCooldownTimer <= 0) {
          this.keysJustPressed.add('Space');
        }
      }
    }

    const inputLen = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (inputLen > 1) {
      inputX /= inputLen;
      inputZ /= inputLen;
    }

    // Trigger Dash
    if (
      (this.keysJustPressed.has('Space') || this.keysJustPressed.has('ShiftLeft')) &&
      p.dashCooldownTimer <= 0 &&
      p.dashTimer <= 0
    ) {
      p.dashTimer = CONFIG.PLAYER.DASH_DURATION;
      p.dashCooldownTimer = this.playerStats.dashCooldown;
      p.iframeTimer = Math.max(p.iframeTimer, CONFIG.PLAYER.DASH_IFRAME);

      if (inputLen > 0.1) {
        p.dashDirX = inputX;
        p.dashDirZ = inputZ;
      } else {
        const aimDx = p.aimX - p.x;
        const aimDz = p.aimZ - p.z;
        const aimLen = Math.sqrt(aimDx * aimDx + aimDz * aimDz) || 1;
        p.dashDirX = aimDx / aimLen;
        p.dashDirZ = aimDz / aimLen;
      }

      this.sound.playSfx('dash');
      this.spawnParticles(p.x, 0.5, p.z, 16, 0x38bdf8, 4, 11, 1.0, 0.35);
      if (this.tutorialStep === 2) {
        this.tutorialStep = 3;
      }
    }

    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.vx = p.dashDirX * CONFIG.PLAYER.DASH_SPEED;
      p.vz = p.dashDirZ * CONFIG.PLAYER.DASH_SPEED;
      if (Math.random() < 0.75) {
        this.spawnParticles(p.x, 0.4, p.z, 2, 0x06b6d4, 1, 3, 0.75, 0.25);
      }
    } else {
      // Responsive acceleration + exponential friction
      p.vx += inputX * CONFIG.PLAYER.ACCELERATION * dt;
      p.vz += inputZ * CONFIG.PLAYER.ACCELERATION * dt;

      const damp = Math.exp(-CONFIG.PLAYER.FRICTION * dt);
      p.vx *= damp;
      p.vz *= damp;

      const spd = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      if (spd > CONFIG.PLAYER.MAX_SPEED) {
        p.vx = (p.vx / spd) * CONFIG.PLAYER.MAX_SPEED;
        p.vz = (p.vz / spd) * CONFIG.PLAYER.MAX_SPEED;
      }
    }

    const nextX = p.x + p.vx * dt;
    const nextZ = p.z + p.vz * dt;
    const resolved = resolveCircleObstacleCollision(
      nextX,
      nextZ,
      CONFIG.PLAYER.RADIUS,
      this.world.obstacles,
      CONFIG.ARENA.PLAYABLE_RADIUS
    );

    const stepDist = Math.sqrt(
      (resolved.x - p.x) * (resolved.x - p.x) + (resolved.z - p.z) * (resolved.z - p.z)
    );
    p.walkDist += stepDist;
    if (this.tutorialStep === 0 && stepDist > 0.01) {
      this.tutorialMoveAccum += stepDist;
      if (this.tutorialMoveAccum > 4.0) {
        this.tutorialStep = 1;
      }
    }

    p.x = resolved.x;
    p.z = resolved.z;

    // Aiming: raycast cursor to ground plane on desktop, or auto-aim at nearest hostile on mobile/unmoved pointer
    if (this.pointerActive && !this.mobileAutoFire) {
      this._raycaster.setFromCamera(this.pointerNdc, this.camera);
      if (this._raycaster.ray.intersectPlane(this._groundPlane, this._intersectPt)) {
        p.aimX = this._intersectPt.x;
        p.aimZ = this._intersectPt.z;
      }
    } else {
      // Auto-aim to nearest hostile
      const target = this.findNearestHostile(p.x, p.z);
      if (target) {
        p.aimX = target.x;
        p.aimZ = target.z;
      } else if (inputLen > 0.1) {
        p.aimX = p.x + inputX * 8;
        p.aimZ = p.z + inputZ * 8;
      }
    }

    const aimDx = p.aimX - p.x;
    const aimDz = p.aimZ - p.z;
    if (aimDx * aimDx + aimDz * aimDz > 0.01) {
      const targetRotY = Math.atan2(-aimDx, -aimDz);
      // Smooth angular interpolation
      let diff = targetRotY - p.rotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.rotY += diff * Math.min(1, dt * 18);
    }

    // Primary Weapon Firing
    p.fireTimer = Math.max(0, p.fireTimer - dt);
    const wantsFire =
      this.mouseDown ||
      this.mobileAutoFire ||
      this.keysHeld.has('KeyJ') ||
      this.keysHeld.has('Enter');

    if (wantsFire && p.fireTimer <= 0) {
      this.firePlayerWeapon();
      p.fireTimer = 1.0 / this.playerStats.fireRate;
    }

    // Companion Orbit Drones Firing
    if (this.playerStats.orbitDroneCount > 0) {
      p.droneFireTimer -= dt;
      if (p.droneFireTimer <= 0) {
        this.fireCompanionDrones();
        p.droneFireTimer = CONFIG.PLAYER.ORBIT_DRONE_FIRE_INTERVAL;
      }
    }
  }

  private findNearestHostile(x: number, z: number): { x: number; z: number } | null {
    let bestDistSq = Infinity;
    let bestX = 0;
    let bestZ = 0;
    let found = false;

    if (this.boss.active) {
      const dx = this.boss.x - x;
      const dz = this.boss.z - z;
      bestDistSq = dx * dx + dz * dz;
      bestX = this.boss.x;
      bestZ = this.boss.z;
      found = true;
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active || e.state === 'ko') continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestX = e.x;
        bestZ = e.z;
        found = true;
      }
    }

    return found ? { x: bestX, z: bestZ } : null;
  }

  private firePlayerWeapon(): void {
    const p = this.player;
    const count = this.playerStats.multishot;
    const spreadStep = 0.11;
    const startAngle = -((count - 1) * spreadStep) * 0.5;

    const forwardX = -Math.sin(p.rotY);
    const forwardZ = -Math.cos(p.rotY);
    const rightX = Math.cos(p.rotY);
    const rightZ = -Math.sin(p.rotY);

    const muzzleX = p.x + rightX * 0.55 + forwardX * 0.9;
    const muzzleZ = p.z + rightZ * 0.55 + forwardZ * 0.9;

    const baseAngle = Math.atan2(forwardZ, forwardX);

    for (let i = 0; i < count; i++) {
      const angle = baseAngle + startAngle + i * spreadStep;
      const isCrit = Math.random() < this.playerStats.critChance;
      const dmg = isCrit
        ? Math.round(this.playerStats.damage * CONFIG.PLAYER.CRIT_MULTIPLIER)
        : this.playerStats.damage;

      this.spawnProjectile(
        true,
        muzzleX,
        1.0,
        muzzleZ,
        Math.cos(angle) * CONFIG.PLAYER.BULLET_SPEED,
        Math.sin(angle) * CONFIG.PLAYER.BULLET_SPEED,
        CONFIG.PLAYER.BULLET_RADIUS,
        dmg,
        isCrit,
        CONFIG.PLAYER.BULLET_LIFETIME,
        this.playerStats.piercing,
        this.playerStats.ricochet
      );
    }

    p.recoilAmount = 1.0;
    this.sound.playSfx('shoot');

    if (this.tutorialStep === 1) {
      this.tutorialShotCount++;
      if (this.tutorialShotCount >= 3) {
        this.tutorialStep = 2;
      }
    }
  }

  private fireCompanionDrones(): void {
    const droneCount = this.playerStats.orbitDroneCount;
    const target = this.findNearestHostile(this.player.x, this.player.z);
    if (!target) return;

    for (let i = 0; i < droneCount; i++) {
      const angle =
        this.totalSimTime * 2.6 + (i / Math.max(1, droneCount)) * Math.PI * 2;
      const dx = this.player.x + Math.cos(angle) * CONFIG.PLAYER.ORBIT_DRONE_RADIUS;
      const dz = this.player.z + Math.sin(angle) * CONFIG.PLAYER.ORBIT_DRONE_RADIUS;

      const aimX = target.x - dx;
      const aimZ = target.z - dz;
      const len = Math.sqrt(aimX * aimX + aimZ * aimZ) || 1;
      const dmg = Math.max(10, Math.round(this.playerStats.damage * 0.55));

      this.spawnProjectile(
        true,
        dx,
        1.25,
        dz,
        (aimX / len) * 28.0,
        (aimZ / len) * 28.0,
        0.22,
        dmg,
        false,
        1.2,
        0,
        0
      );
    }
  }

  private spawnProjectile(
    isPlayer: boolean,
    x: number,
    y: number,
    z: number,
    vx: number,
    vz: number,
    radius: number,
    damage: number,
    isCrit: boolean,
    life: number,
    pierceLeft: number,
    ricochetLeft: number
  ): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) {
        pr.active = true;
        pr.isPlayer = isPlayer;
        pr.x = x;
        pr.y = y;
        pr.z = z;
        pr.vx = vx;
        pr.vz = vz;
        pr.radius = radius;
        pr.damage = damage;
        pr.isCrit = isCrit;
        pr.life = life;
        pr.pierceLeft = pierceLeft;
        pr.ricochetLeft = ricochetLeft;
        pr.hitEnemyIds.clear();
        return;
      }
    }
  }

  private stepWaveSpawner(dt: number): void {
    if (this.waveIntermissionTimer > 0) {
      this.waveIntermissionTimer -= dt;
      if (this.waveIntermissionTimer <= 0) {
        this.beginWave(this.wave + 1);
      }
      return;
    }

    const wCfg = getWaveConfig(this.wave);

    if (this.waveEnemiesRemainingToSpawn > 0) {
      this.waveSpawnTimer -= dt;
      if (this.waveSpawnTimer <= 0) {
        const type = pickWeightedEnemyType(wCfg.weights);
        const angle = Math.random() * Math.PI * 2;
        const spawnR = CONFIG.ARENA.PLAYABLE_RADIUS - 2.2;
        const sx = Math.cos(angle) * spawnR;
        const sz = Math.sin(angle) * spawnR;

        if (this.spawnEnemy(type, sx, sz, wCfg.hpMultiplier, wCfg.speedMultiplier)) {
          this.waveEnemiesRemainingToSpawn--;
        }
        this.waveSpawnTimer = wCfg.spawnInterval;
      }
    } else {
      // Check if all enemies and boss are defeated
      let anyAlive = this.boss.active;
      if (!anyAlive) {
        for (let i = 0; i < this.enemies.length; i++) {
          if (this.enemies[i].active) {
            anyAlive = true;
            break;
          }
        }
      }
      if (!anyAlive) {
        this.waveIntermissionTimer = CONFIG.WAVE.INTERMISSION_SECONDS;
        this.waveBannerText = `WAVE ${this.wave} CLEARED`;
        this.waveBannerTimer = 2.2;
      }
    }
  }

  private spawnEnemy(
    type: EnemyType,
    x: number,
    z: number,
    hpMult = 1.0,
    speedMult = 1.0
  ): boolean {
    const cfg = CONFIG.ENEMIES[type];
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active) {
        e.active = true;
        e.id = this.nextEnemyId++;
        e.type = type;
        e.x = x;
        e.z = z;
        e.prevX = x;
        e.prevZ = z;
        e.vx = 0;
        e.vz = 0;
        e.rotY = 0;
        e.maxHp = Math.round(cfg.hp * hpMult);
        e.hp = e.maxHp;
        e.speed = cfg.speed * speedMult;
        e.radius = cfg.radius;
        e.contactDamage = cfg.contactDamage;
        e.scoreValue = cfg.score;
        e.xpValue = cfg.xp;
        e.hitFlashTimer = 0;
        e.koTimer = 0;
        e.state = 'seek';
        e.stateTimer = 0;
        e.cooldownTimer = 1.0 + Math.random() * 1.2;
        e.chargeDirX = 0;
        e.chargeDirZ = 1;
        return true;
      }
    }
    return false;
  }

  private stepEnemies(dt: number): void {
    this.spatialHash.clear();

    // Insert active non-KO enemies into SpatialHash2D
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.active && e.state !== 'ko') {
        this.spatialHash.insert(i, e.x, e.z, e.radius);
      }
    }

    // Track crowd attack tokens for Shooter/Dasher windups
    let activeAttackers = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.active && (e.state === 'telegraph' || e.state === 'charge')) {
        activeAttackers++;
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active) continue;

      e.prevX = e.x;
      e.prevZ = e.z;

      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
      }

      // KO topple/shrink animation state
      if (e.state === 'ko') {
        e.koTimer -= dt;
        e.x += e.vx * dt;
        e.z += e.vz * dt;
        if (e.koTimer <= 0) {
          e.active = false;
        }
        continue;
      }

      const dxToPlayer = this.player.x - e.x;
      const dzToPlayer = this.player.z - e.z;
      const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dzToPlayer * dzToPlayer) || 0.001;
      const dirX = dxToPlayer / distToPlayer;
      const dirZ = dzToPlayer / distToPlayer;

      if (e.cooldownTimer > 0) {
        e.cooldownTimer = Math.max(0, e.cooldownTimer - dt);
      }

      // Archetype-specific AI policy
      if (e.type === 'dasher') {
        if (e.state === 'seek') {
          e.vx = dirX * e.speed;
          e.vz = dirZ * e.speed;
          e.rotY = Math.atan2(-dirX, -dirZ);

          if (
            distToPlayer <= CONFIG.ENEMIES.dasher.chargeTriggerRange &&
            e.cooldownTimer <= 0 &&
            activeAttackers < CONFIG.WAVE.MAX_CONCURRENT_ATTACK_TOKENS
          ) {
            e.state = 'telegraph';
            e.stateTimer = CONFIG.ENEMIES.dasher.telegraphDuration;
            e.chargeDirX = dirX;
            e.chargeDirZ = dirZ;
            e.rotY = Math.atan2(-dirX, -dirZ);
            e.vx = 0;
            e.vz = 0;
            activeAttackers++;
            this.sound.playSfx('telegraph', e.x - this.player.x, e.z - this.player.z);
          }
        } else if (e.state === 'telegraph') {
          e.vx = 0;
          e.vz = 0;
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            e.state = 'charge';
            e.stateTimer = CONFIG.ENEMIES.dasher.chargeDuration;
          }
        } else if (e.state === 'charge') {
          e.vx = e.chargeDirX * CONFIG.ENEMIES.dasher.chargeSpeed;
          e.vz = e.chargeDirZ * CONFIG.ENEMIES.dasher.chargeSpeed;
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            e.state = 'seek';
            e.cooldownTimer = CONFIG.ENEMIES.dasher.chargeCooldown;
          }
        }
      } else if (e.type === 'shooter') {
        const pref = CONFIG.ENEMIES.shooter.preferredRange;
        e.rotY = Math.atan2(-dirX, -dirZ);

        if (e.state === 'telegraph') {
          e.vx *= 0.85;
          e.vz *= 0.85;
          e.stateTimer -= dt;
          if (e.stateTimer <= 0) {
            // Fire projectile at player
            this.spawnProjectile(
              false,
              e.x + dirX * 0.8,
              1.05,
              e.z + dirZ * 0.8,
              dirX * CONFIG.ENEMIES.shooter.projectileSpeed,
              dirZ * CONFIG.ENEMIES.shooter.projectileSpeed,
              0.28,
              CONFIG.ENEMIES.shooter.projectileDamage,
              false,
              3.2,
              0,
              0
            );
            e.state = 'seek';
            e.cooldownTimer = CONFIG.ENEMIES.shooter.fireInterval;
          }
        } else {
          if (distToPlayer > pref + 2.0) {
            e.vx = dirX * e.speed;
            e.vz = dirZ * e.speed;
          } else if (distToPlayer < pref - 2.5) {
            e.vx = -dirX * e.speed * 0.75;
            e.vz = -dirZ * e.speed * 0.75;
          } else {
            // Strafe around player
            e.vx = -dirZ * e.speed * 0.65;
            e.vz = dirX * e.speed * 0.65;
          }

          if (
            e.cooldownTimer <= 0 &&
            distToPlayer < 24 &&
            activeAttackers < CONFIG.WAVE.MAX_CONCURRENT_ATTACK_TOKENS
          ) {
            e.state = 'telegraph';
            e.stateTimer = CONFIG.ENEMIES.shooter.windupDuration;
            e.hitFlashTimer = 0.25;
            activeAttackers++;
          }
        }
      } else {
        // Chaser, Tank, Splitter, SplitterMini
        e.vx = dirX * e.speed;
        e.vz = dirZ * e.speed;
        e.rotY = Math.atan2(-dirX, -dirZ);
      }

      // Soft separation against neighboring enemies via SpatialHash2D
      const neighbors = this.spatialHash.query(e.x, e.z, e.radius * 2.2);
      for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
        const otherIdx = neighbors[nIdx];
        if (otherIdx === i) continue;
        const other = this.enemies[otherIdx];
        const sdx = e.x - other.x;
        const sdz = e.z - other.z;
        const minSep = e.radius + other.radius;
        const dSq = sdx * sdx + sdz * sdz;
        if (dSq > 0.0001 && dSq < minSep * minSep) {
          const d = Math.sqrt(dSq);
          const push = ((minSep - d) / minSep) * 14.0;
          e.vx += (sdx / d) * push;
          e.vz += (sdz / d) * push;
        }
      }

      const resolved = resolveCircleObstacleCollision(
        e.x + e.vx * dt,
        e.z + e.vz * dt,
        e.radius,
        this.world.obstacles,
        CONFIG.ARENA.PLAYABLE_RADIUS
      );
      e.x = resolved.x;
      e.z = resolved.z;

      // Check contact damage with player
      const pDx = this.player.x - e.x;
      const pDz = this.player.z - e.z;
      const minPlayerDist = e.radius + CONFIG.PLAYER.RADIUS;
      if (pDx * pDx + pDz * pDz < minPlayerDist * minPlayerDist) {
        this.damagePlayer(e.contactDamage, e.x, e.z);
      }
    }
  }

  private stepBoss(dt: number): void {
    if (!this.boss.active) return;

    const b = this.boss;
    if (b.hitFlashTimer > 0) {
      b.hitFlashTimer = Math.max(0, b.hitFlashTimer - dt);
    }

    const dx = this.player.x - b.x;
    const dz = this.player.z - b.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // If charging ground slam telegraph, hold position and expand telegraph ring
    if (b.slamTelegraphTimer > 0) {
      b.slamTelegraphTimer -= dt;
      this.bossRig.telegraphRing.visible = true;
      this.bossRig.telegraphFill.visible = true;
      const progress =
        1.0 - b.slamTelegraphTimer / CONFIG.BOSS.slamTelegraphDuration;
      this.bossRig.telegraphFill.scale.setScalar(Math.max(0.05, progress));

      if (b.slamTelegraphTimer <= 0) {
        this.bossRig.telegraphRing.visible = false;
        this.bossRig.telegraphFill.visible = false;
        this.spawnShockwave(b.x, b.z, CONFIG.BOSS.slamRadius, 0xff1e56, 0.5);
        this.spawnParticles(b.x, 0.8, b.z, 28, 0xf43f5e, 6, 18, 1.3, 0.55);
        this.sound.playSfx('explosion', b.x - this.player.x, b.z - this.player.z);
        this.addCameraTrauma(0.65);

        if (dist <= CONFIG.BOSS.slamRadius + CONFIG.PLAYER.RADIUS) {
          this.damagePlayer(CONFIG.BOSS.slamDamage, b.x, b.z);
        }
      }
    } else {
      // Move steadily toward player
      b.vx = dirX * CONFIG.BOSS.speed;
      b.vz = dirZ * CONFIG.BOSS.speed;
      const resolved = resolveCircleObstacleCollision(
        b.x + b.vx * dt,
        b.z + b.vz * dt,
        CONFIG.BOSS.radius,
        this.world.obstacles,
        CONFIG.ARENA.PLAYABLE_RADIUS
      );
      b.x = resolved.x;
      b.z = resolved.z;

      // Cycle boss attack phases (0: Radial Bullet Ring, 1: Summon Minions, 2: Area Ground Slam)
      b.phaseTimer -= dt;
      if (b.phaseTimer <= 0) {
        if (b.phase === 0) {
          const count = CONFIG.BOSS.radialBulletCount;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + this.totalSimTime;
            this.spawnProjectile(
              false,
              b.x + Math.cos(a) * 2.2,
              1.4,
              b.z + Math.sin(a) * 2.2,
              Math.cos(a) * CONFIG.BOSS.radialBulletSpeed,
              Math.sin(a) * CONFIG.BOSS.radialBulletSpeed,
              0.34,
              CONFIG.BOSS.radialBulletDamage,
              false,
              4.0,
              0,
              0
            );
          }
          this.sound.playSfx('shoot', b.x - this.player.x, b.z - this.player.z);
        } else if (b.phase === 1) {
          for (let i = 0; i < CONFIG.BOSS.summonCount; i++) {
            const a = (i / CONFIG.BOSS.summonCount) * Math.PI * 2;
            this.spawnEnemy(
              i % 2 === 0 ? 'chaser' : 'dasher',
              b.x + Math.cos(a) * 4.2,
              b.z + Math.sin(a) * 4.2,
              getWaveConfig(this.wave).hpMultiplier,
              getWaveConfig(this.wave).speedMultiplier
            );
          }
          this.spawnShockwave(b.x, b.z, 5.5, 0xfbbf24, 0.4);
        } else {
          b.slamTelegraphTimer = CONFIG.BOSS.slamTelegraphDuration;
          this.sound.playSfx('telegraph', b.x - this.player.x, b.z - this.player.z);
        }

        b.phase = (b.phase + 1) % 3;
        b.phaseTimer = CONFIG.BOSS.phaseCycleSeconds;
      }
    }

    // Contact damage with player
    if (dist < CONFIG.BOSS.radius + CONFIG.PLAYER.RADIUS) {
      this.damagePlayer(CONFIG.BOSS.contactDamage, b.x, b.z);
    }
  }

  private stepProjectiles(playerDt: number, enemyDt: number): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;

      const dt = pr.isPlayer ? playerDt : enemyDt;
      pr.life -= dt;
      if (pr.life <= 0) {
        pr.active = false;
        continue;
      }

      const nextX = pr.x + pr.vx * dt;
      const nextZ = pr.z + pr.vz * dt;

      // Check obstacle & arena wall collision
      const col = resolveCircleObstacleCollision(
        nextX,
        nextZ,
        pr.radius,
        this.world.obstacles,
        CONFIG.ARENA.PLAYABLE_RADIUS
      );

      if (col.hitBoundary) {
        if (pr.isPlayer && pr.ricochetLeft > 0) {
          pr.ricochetLeft--;
          // Reflect velocity vector across normal
          const dot = pr.vx * col.normalX + pr.vz * col.normalZ;
          pr.vx = pr.vx - 2 * dot * col.normalX;
          pr.vz = pr.vz - 2 * dot * col.normalZ;
          pr.x = col.x;
          pr.z = col.z;
          this.spawnParticles(pr.x, pr.y, pr.z, 4, 0xa855f7, 2, 6, 0.6, 0.2);
        } else {
          this.spawnParticles(
            col.x,
            pr.y,
            col.z,
            4,
            pr.isPlayer ? 0x38bdf8 : 0xf43f5e,
            2,
            7,
            0.65,
            0.22
          );
          pr.active = false;
          continue;
        }
      } else {
        pr.x = nextX;
        pr.z = nextZ;
      }

      if (pr.isPlayer) {
        // Check hit against Boss
        if (this.boss.active && !pr.hitEnemyIds.has(-999)) {
          const bdx = this.boss.x - pr.x;
          const bdz = this.boss.z - pr.z;
          const bRad = CONFIG.BOSS.radius + pr.radius;
          if (bdx * bdx + bdz * bdz <= bRad * bRad) {
            pr.hitEnemyIds.add(-999);
            this.damageBoss(pr.damage, pr.isCrit, pr.x, pr.z);
            if (pr.pierceLeft > 0) {
              pr.pierceLeft--;
            } else {
              pr.active = false;
              continue;
            }
          }
        }

        // Query SpatialHash2D for enemy hits
        const candidates = this.spatialHash.query(pr.x, pr.z, pr.radius + 1.5);
        for (let c = 0; c < candidates.length; c++) {
          const eIdx = candidates[c];
          const e = this.enemies[eIdx];
          if (!e.active || e.state === 'ko' || pr.hitEnemyIds.has(e.id)) continue;

          const edx = e.x - pr.x;
          const edz = e.z - pr.z;
          const rSum = e.radius + pr.radius;
          if (edx * edx + edz * edz <= rSum * rSum) {
            pr.hitEnemyIds.add(e.id);
            this.damageEnemy(e, pr.damage, pr.isCrit, pr.vx, pr.vz);

            if (pr.pierceLeft > 0) {
              pr.pierceLeft--;
            } else if (pr.ricochetLeft > 0) {
              pr.ricochetLeft--;
              // Chain toward another nearby enemy if available
              const chainTarget = this.findChainTarget(e.x, e.z, pr.hitEnemyIds);
              if (chainTarget) {
                const cdx = chainTarget.x - pr.x;
                const cdz = chainTarget.z - pr.z;
                const clen = Math.sqrt(cdx * cdx + cdz * cdz) || 1;
                const spd = Math.sqrt(pr.vx * pr.vx + pr.vz * pr.vz);
                pr.vx = (cdx / clen) * spd;
                pr.vz = (cdz / clen) * spd;
              } else {
                pr.vx = -pr.vx;
                pr.vz = -pr.vz;
              }
            } else {
              pr.active = false;
              break;
            }
          }
        }
      } else {
        // Enemy projectile vs Player
        const pDx = this.player.x - pr.x;
        const pDz = this.player.z - pr.z;
        const pRad = CONFIG.PLAYER.RADIUS + pr.radius;
        if (pDx * pDx + pDz * pDz <= pRad * pRad) {
          pr.active = false;
          this.damagePlayer(pr.damage, pr.x, pr.z);
        }
      }
    }
  }

  private findChainTarget(
    fromX: number,
    fromZ: number,
    excludeIds: Set<number>
  ): EnemyInstance | null {
    let best: EnemyInstance | null = null;
    let bestDistSq = 12 * 12;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active || e.state === 'ko' || excludeIds.has(e.id)) continue;
      const dx = e.x - fromX;
      const dz = e.z - fromZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private damageEnemy(
    e: EnemyInstance,
    damage: number,
    isCrit: boolean,
    impactVx: number,
    impactVz: number
  ): void {
    e.hp -= damage;
    e.hitFlashTimer = 0.08;

    const impLen = Math.sqrt(impactVx * impactVx + impactVz * impactVz) || 1;
    e.x += (impactVx / impLen) * 0.22;
    e.z += (impactVz / impLen) * 0.22;

    this.spawnFloatingText(
      e.x,
      1.5,
      e.z,
      isCrit ? `${damage}!` : `${damage}`,
      isCrit ? '#facc15' : '#f8fafc',
      isCrit ? 1.25 : 1.0
    );

    const cfg = CONFIG.ENEMIES[e.type];
    this.spawnParticles(e.x, 0.9, e.z, 5, cfg.colorHex, 3, 9, 0.7, 0.25);

    if (e.hp <= 0 && e.state !== 'ko') {
      this.killEnemy(e, impactVx / impLen, impactVz / impLen);
    } else {
      this.sound.playSfx('hit', e.x - this.player.x, e.z - this.player.z);
    }
  }

  private killEnemy(e: EnemyInstance, knockDirX: number, knockDirZ: number): void {
    e.state = 'ko';
    e.koTimer = 0.24;
    e.vx = knockDirX * 8.5;
    e.vz = knockDirZ * 8.5;

    const cfg = CONFIG.ENEMIES[e.type];
    this.kills++;
    this.comboCount++;
    this.comboTimer = CONFIG.COMBO.RESET_SECONDS;
    const pts = calculateKillScore(e.scoreValue, this.comboCount);
    this.score += pts;
    if (this.score > this.highScore) {
      this.highScore = this.score;
    }

    // Brief hitstop on heavy enemies
    if (e.type === 'tank' || e.type === 'dasher') {
      this.hitstopTimer = 0.042;
      this.addCameraTrauma(0.28);
    } else {
      this.addCameraTrauma(0.1);
    }

    this.sound.playSfx('kill', e.x - this.player.x, e.z - this.player.z);
    this.spawnParticles(e.x, 0.9, e.z, 16, cfg.colorHex, 4, 13, 1.0, 0.42);
    this.spawnShockwave(e.x, e.z, e.radius * 2.6, cfg.colorHex, 0.32);

    // Splitter spawns 3 mini shards on death
    if (e.type === 'splitter') {
      const splitCount = CONFIG.ENEMIES.splitter.splitCount;
      const wCfg = getWaveConfig(this.wave);
      for (let s = 0; s < splitCount; s++) {
        const angle = (s / splitCount) * Math.PI * 2 + Math.random() * 0.5;
        this.spawnEnemy(
          'splitter_mini',
          e.x + Math.cos(angle) * 0.9,
          e.z + Math.sin(angle) * 0.9,
          wCfg.hpMultiplier,
          wCfg.speedMultiplier
        );
      }
    }

    // Volatile Kill Explosion Upgrade
    if (this.playerStats.killExplosionLevel > 0) {
      const blastRadius =
        CONFIG.PLAYER.KILL_EXPLOSION_RADIUS *
        (1 + (this.playerStats.killExplosionLevel - 1) * 0.2);
      const blastDmg = Math.round(
        this.playerStats.damage *
          CONFIG.PLAYER.KILL_EXPLOSION_DAMAGE_RATIO *
          this.playerStats.killExplosionLevel
      );
      this.spawnShockwave(e.x, e.z, blastRadius, 0xfb923c, 0.38);

      const nearby = this.spatialHash.query(e.x, e.z, blastRadius);
      for (let n = 0; n < nearby.length; n++) {
        const other = this.enemies[nearby[n]];
        if (!other.active || other.state === 'ko' || other.id === e.id) continue;
        const dx = other.x - e.x;
        const dz = other.z - e.z;
        if (dx * dx + dz * dz <= blastRadius * blastRadius) {
          other.hp -= blastDmg;
          other.hitFlashTimer = 0.08;
          if (other.hp <= 0) {
            this.killEnemy(other, dx, dz);
          }
        }
      }
    }

    // Drop XP orb + chance for temporary powerup pickup
    this.spawnPickup('xp', e.x, e.z, e.xpValue);
    if (Math.random() < CONFIG.PROGRESSION.PICKUP_DROP_CHANCE) {
      const roll = Math.random();
      const pType: PickupType =
        roll < 0.35
          ? 'health'
          : roll < 0.62
          ? 'shield'
          : roll < 0.84
          ? 'slow_time'
          : 'nuke';
      this.spawnPickup(pType, e.x + 0.5, e.z + 0.5, 1);
    }
  }

  private damageBoss(
    damage: number,
    isCrit: boolean,
    hitX: number,
    hitZ: number
  ): void {
    const b = this.boss;
    b.hp -= damage;
    b.hitFlashTimer = 0.07;
    this.spawnFloatingText(
      hitX,
      2.6,
      hitZ,
      isCrit ? `${damage}!` : `${damage}`,
      isCrit ? '#facc15' : '#fda4af',
      isCrit ? 1.3 : 1.05
    );
    this.spawnParticles(hitX, 1.5, hitZ, 6, 0xf43f5e, 3, 10, 0.85, 0.25);

    if (b.hp <= 0) {
      b.active = false;
      this.bossRig.root.visible = false;
      this.hitstopTimer = 0.065;
      this.addCameraTrauma(0.85);
      this.sound.playSfx('explosion', b.x - this.player.x, b.z - this.player.z);
      this.spawnParticles(b.x, 1.8, b.z, 45, 0xf43f5e, 5, 20, 1.4, 0.65);
      this.spawnShockwave(b.x, b.z, 11.0, 0xf43f5e, 0.6);

      this.kills++;
      this.comboCount += 5;
      this.comboTimer = CONFIG.COMBO.RESET_SECONDS;
      this.score += calculateKillScore(CONFIG.BOSS.score, this.comboCount);
      if (this.score > this.highScore) this.highScore = this.score;

      // Shower of XP orbs & guaranteed pickups
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.spawnPickup(
          'xp',
          b.x + Math.cos(a) * 2.2,
          b.z + Math.sin(a) * 2.2,
          Math.round(CONFIG.BOSS.xp / 10)
        );
      }
      this.spawnPickup('health', b.x, b.z, 1);
    } else {
      this.sound.playSfx('hit', b.x - this.player.x, b.z - this.player.z);
    }
  }

  private damagePlayer(amount: number, sourceX: number, sourceZ: number): void {
    const p = this.player;
    if (p.iframeTimer > 0) return;

    if (p.shieldTimer > 0) {
      p.iframeTimer = 0.25;
      this.sound.playSfx('hit');
      this.spawnParticles(p.x, 1.0, p.z, 10, 0x38bdf8, 3, 9, 0.8, 0.25);
      return;
    }

    p.hp = Math.max(0, p.hp - amount);
    p.iframeTimer = CONFIG.PLAYER.HURT_IFRAME;
    p.hitFlashTimer = 0.18;
    this.hitstopTimer = 0.048;
    this.camState.chromaticPulse = 0.022;
    this.addCameraTrauma(0.52);

    // Directional knockback impulse
    const dx = p.x - sourceX;
    const dz = p.z - sourceZ;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    p.vx += (dx / len) * 14.0;
    p.vz += (dz / len) * 14.0;

    this.sound.playSfx('playerHurt');
    this.spawnParticles(p.x, 1.0, p.z, 18, 0xf43f5e, 4, 12, 1.0, 0.38);
    this.spawnFloatingText(p.x, 1.8, p.z, `-${amount}`, '#f43f5e', 1.3);

    if (p.hp <= 0) {
      this.triggerGameOver();
    }
  }

  private triggerGameOver(): void {
    this.sound.playSfx('explosion');
    this.spawnParticles(this.player.x, 1.0, this.player.z, 36, 0x38bdf8, 4, 16, 1.3, 0.65);
    this.setMode('gameover');
  }

  private spawnPickup(type: PickupType, x: number, z: number, value: number): void {
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      if (!pk.active) {
        pk.active = true;
        pk.type = type;
        pk.x = x;
        pk.z = z;
        pk.vx = (Math.random() - 0.5) * 3.0;
        pk.vz = (Math.random() - 0.5) * 3.0;
        pk.value = value;
        pk.age = 0;
        return;
      }
    }
  }

  private stepPickups(dt: number): void {
    const p = this.player;
    const magRange = this.playerStats.magnetRange;
    const magRangeSq = magRange * magRange;

    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      if (!pk.active) continue;

      pk.age += dt;
      const dx = p.x - pk.x;
      const dz = p.z - pk.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < magRangeSq) {
        const dist = Math.sqrt(distSq) || 0.001;
        const pullSpeed = 16.0 + (1.0 - dist / magRange) * 14.0;
        pk.vx = (dx / dist) * pullSpeed;
        pk.vz = (dz / dist) * pullSpeed;
      } else {
        pk.vx *= Math.exp(-6.0 * dt);
        pk.vz *= Math.exp(-6.0 * dt);
      }

      pk.x += pk.vx * dt;
      pk.z += pk.vz * dt;

      // Collect pickup
      if (distSq <= 1.25 * 1.25) {
        pk.active = false;
        this.sound.playSfx('pickup');

        if (pk.type === 'xp') {
          p.xp += pk.value;
          while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext;
            p.level++;
            p.xpToNext = xpRequiredForLevel(p.level);
            this.triggerLevelUp();
          }
        } else if (pk.type === 'health') {
          const heal = CONFIG.PROGRESSION.HEALTH_PICKUP_AMOUNT;
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.spawnFloatingText(p.x, 1.9, p.z, `+${heal} HP`, '#4ade80', 1.25);
        } else if (pk.type === 'shield') {
          p.shieldTimer = CONFIG.PROGRESSION.SHIELD_DURATION;
          this.spawnFloatingText(p.x, 1.9, p.z, 'AEGIS SHIELD!', '#38bdf8', 1.25);
        } else if (pk.type === 'slow_time') {
          p.slowTimeTimer = CONFIG.PROGRESSION.SLOW_TIME_DURATION;
          this.spawnFloatingText(p.x, 1.9, p.z, 'CHRONO SHIFT!', '#a855f7', 1.25);
        } else if (pk.type === 'nuke') {
          this.triggerTacticalNuke();
        }
      }
    }
  }

  private triggerTacticalNuke(): void {
    this.spawnFloatingText(this.player.x, 2.1, this.player.z, 'EMP OVERLOAD!', '#f59e0b', 1.4);
    this.spawnShockwave(this.player.x, this.player.z, 28.0, 0xf59e0b, 0.65);
    this.sound.playSfx('explosion');
    this.addCameraTrauma(0.75);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.active && e.state !== 'ko') {
        this.killEnemy(e, 0, 1);
      }
    }
  }

  private triggerLevelUp(): void {
    this.sound.playSfx('levelup');
    this.spawnShockwave(this.player.x, this.player.z, 6.5, 0x38bdf8, 0.5);
    this.currentUpgradeChoices = pickUpgradeChoices(this.upgradeLevels, 3);
    if (this.currentUpgradeChoices.length > 0) {
      this.setMode('levelup');
    }
  }

  private stepParticlesAndShockwaves(dt: number): void {
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      pt.age += dt;
      if (pt.age >= pt.maxAge) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.vy -= 14.0 * dt; // Gravity on sparks
      if (pt.y < 0.05) {
        pt.y = 0.05;
        pt.vx *= 0.7;
        pt.vz *= 0.7;
      }
    }

    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.age += dt;
      if (sw.age >= sw.maxAge) {
        sw.active = false;
        sw.mesh.visible = false;
        continue;
      }
      const t = sw.age / sw.maxAge;
      const r = 0.3 + t * sw.maxRadius;
      sw.mesh.scale.setScalar(r);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - t) * 0.8;
    }
  }

  // Visual Sync & Interpolation before rendering
  private updateVisualScene(alpha: number, realDt: number): void {
    const p = this.player;
    const interpX = THREE.MathUtils.lerp(p.prevX, p.x, alpha);
    const interpZ = THREE.MathUtils.lerp(p.prevZ, p.z, alpha);

    // 1. Update Player Mech Group & Procedural Gait/Lean/Recoil Animation
    this.playerRig.root.position.set(interpX, 0, interpZ);
    this.playerRig.root.rotation.y = p.rotY;

    const speedRatio = Math.min(
      1,
      Math.sqrt(p.vx * p.vx + p.vz * p.vz) / CONFIG.PLAYER.MAX_SPEED
    );
    const walkCycle = p.walkDist * 2.2;
    this.playerRig.bodyGroup.position.y =
      0.85 + Math.abs(Math.sin(walkCycle)) * 0.09 * speedRatio;
    this.playerRig.leftLeg.rotation.x = Math.sin(walkCycle) * 0.55 * speedRatio;
    this.playerRig.rightLeg.rotation.x = -Math.sin(walkCycle) * 0.55 * speedRatio;

    // Lean into movement velocity
    this.playerRig.bodyGroup.rotation.x = -speedRatio * 0.14;
    this.playerRig.weaponPivot.position.z = -0.15 + p.recoilAmount * 0.16;
    (this.playerRig.muzzleFlash.material as THREE.MeshBasicMaterial).opacity =
      p.recoilAmount > 0.65 ? 0.9 : 0.0;
    this.playerRig.muzzleFlash.rotation.z += realDt * 18;

    this.playerRig.shieldDome.visible = p.shieldTimer > 0;
    if (p.shieldTimer > 0) {
      this.playerRig.shieldDome.rotation.y += realDt * 1.8;
    }

    // Hit flash on player armor
    this.playerRig.armorMaterials[0].emissive.setHex(
      p.hitFlashTimer > 0 ? 0xf43f5e : 0x000000
    );
    this.playerRig.armorMaterials[0].emissiveIntensity = p.hitFlashTimer > 0 ? 1.5 : 0;

    // 2. Update Companion Orbit Drones
    const droneCount = this.playerStats.orbitDroneCount;
    for (let i = 0; i < this.companionDrones.length; i++) {
      const drone = this.companionDrones[i];
      if (i < droneCount && this.mode !== 'title') {
        drone.visible = true;
        const angle =
          this.totalSimTime * 2.6 + (i / Math.max(1, droneCount)) * Math.PI * 2;
        drone.position.set(
          interpX + Math.cos(angle) * CONFIG.PLAYER.ORBIT_DRONE_RADIUS,
          1.35 + Math.sin(this.totalSimTime * 4 + i) * 0.15,
          interpZ + Math.sin(angle) * CONFIG.PLAYER.ORBIT_DRONE_RADIUS
        );
        drone.rotation.y = -angle;
      } else {
        drone.visible = false;
      }
    }

    // 3. Update Directional Shadow Light following Player
    this.world.dirLight.position.set(interpX + 14, 28, interpZ + 16);
    this.world.dirLight.target.position.set(interpX, 0, interpZ);
    this.world.dirLight.target.updateMatrixWorld();

    // Flickering Point Lights + rotating starfield
    for (let i = 0; i < this.world.pointLights.length; i++) {
      const pl = this.world.pointLights[i];
      pl.light.intensity =
        pl.baseIntensity + Math.sin(this.totalSimTime * 5.5 + pl.phase) * 0.45;
    }
    this.world.starField.rotation.y += realDt * 0.015;

    // 4. Update Enemy InstancedMeshes & Dasher Telegraph Corridors
    const counts: Record<EnemyType, number> = {
      chaser: 0,
      tank: 0,
      shooter: 0,
      splitter: 0,
      splitter_mini: 0,
      dasher: 0,
    };

    let telegraphIdx = 0;
    for (let i = 0; i < this.dasherTelegraphMeshes.length; i++) {
      this.dasherTelegraphMeshes[i].visible = false;
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active) continue;

      const mesh = this.enemyInstancedMeshes[e.type];
      const idx = counts[e.type]++;

      const ex = THREE.MathUtils.lerp(e.prevX, e.x, alpha);
      const ez = THREE.MathUtils.lerp(e.prevZ, e.z, alpha);

      this._dummy.position.set(ex, 0, ez);
      this._dummy.rotation.set(0, e.rotY, 0);

      if (e.state === 'ko') {
        const koRatio = Math.max(0.05, e.koTimer / 0.24);
        this._dummy.scale.set(koRatio, koRatio * 0.5, koRatio);
        this._dummy.rotation.x = (1 - koRatio) * 1.4;
      } else {
        const pulse =
          e.state === 'telegraph'
            ? 1.0 + Math.sin(this.totalSimTime * 28) * 0.16
            : 1.0;
        this._dummy.scale.setScalar(pulse);
      }

      this._dummy.updateMatrix();
      mesh.setMatrixAt(idx, this._dummy.matrix);

      const cfg = CONFIG.ENEMIES[e.type];
      if (e.hitFlashTimer > 0) {
        this._color.setHex(0xffffff);
      } else {
        this._color.setHex(cfg.colorHex);
      }
      mesh.setColorAt(idx, this._color);

      // Show Dasher telegraph line on floor
      if (
        e.type === 'dasher' &&
        e.state === 'telegraph' &&
        telegraphIdx < this.dasherTelegraphMeshes.length
      ) {
        const tm = this.dasherTelegraphMeshes[telegraphIdx++];
        tm.visible = true;
        tm.position.set(ex, 0.035, ez);
        tm.rotation.y = Math.atan2(-e.chargeDirX, -e.chargeDirZ);
      }
    }

    (Object.keys(counts) as EnemyType[]).forEach((t) => {
      const im = this.enemyInstancedMeshes[t];
      im.count = counts[t];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });

    // 5. Update Boss Rig
    if (this.boss.active) {
      this.bossRig.root.position.set(this.boss.x, 0, this.boss.z);
      this.bossRig.coreMesh.rotation.y += realDt * 0.8;
      this.bossRig.innerRing.rotation.z += realDt * 2.4;
      this.bossRig.outerRing.rotation.y -= realDt * 1.3;
      this.bossRig.materials[0].emissive.setHex(
        this.boss.hitFlashTimer > 0 ? 0xffffff : 0x000000
      );
      this.bossRig.materials[0].emissiveIntensity =
        this.boss.hitFlashTimer > 0 ? 1.2 : 0;
    }

    // 6. Update Projectiles InstancedMeshes
    let pBulletCount = 0;
    let eBulletCount = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;

      this._dummy.position.set(pr.x, pr.y, pr.z);
      this._dummy.rotation.set(0, Math.atan2(-pr.vx, -pr.vz), 0);
      this._dummy.scale.setScalar(pr.isCrit ? 1.35 : 1.0);
      this._dummy.updateMatrix();

      if (pr.isPlayer) {
        this.playerBulletInstanced.setMatrixAt(pBulletCount, this._dummy.matrix);
        this._color.setHex(pr.isCrit ? 0xfacc15 : 0x38bdf8);
        this.playerBulletInstanced.setColorAt(pBulletCount, this._color);
        pBulletCount++;
      } else {
        this.enemyBulletInstanced.setMatrixAt(eBulletCount, this._dummy.matrix);
        eBulletCount++;
      }
    }
    this.playerBulletInstanced.count = pBulletCount;
    this.playerBulletInstanced.instanceMatrix.needsUpdate = true;
    if (this.playerBulletInstanced.instanceColor) {
      this.playerBulletInstanced.instanceColor.needsUpdate = true;
    }
    this.enemyBulletInstanced.count = eBulletCount;
    this.enemyBulletInstanced.instanceMatrix.needsUpdate = true;

    // 7. Update Pickups InstancedMesh
    let pkCount = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      if (!pk.active) continue;

      const bobY = 0.55 + Math.sin(pk.age * 5.0 + i) * 0.16;
      const pulseScale =
        pk.type === 'xp' ? 0.85 : 1.35 + Math.sin(pk.age * 7.0) * 0.18;

      this._dummy.position.set(pk.x, bobY, pk.z);
      this._dummy.rotation.set(0, pk.age * 3.2, 0);
      this._dummy.scale.setScalar(pulseScale);
      this._dummy.updateMatrix();

      this.pickupInstanced.setMatrixAt(pkCount, this._dummy.matrix);
      if (pk.type === 'xp') this._color.setHex(0x38bdf8);
      else if (pk.type === 'health') this._color.setHex(0x4ade80);
      else if (pk.type === 'shield') this._color.setHex(0x60a5fa);
      else if (pk.type === 'slow_time') this._color.setHex(0xc084fc);
      else this._color.setHex(0xf59e0b);

      this.pickupInstanced.setColorAt(pkCount, this._color);
      pkCount++;
    }
    this.pickupInstanced.count = pkCount;
    this.pickupInstanced.instanceMatrix.needsUpdate = true;
    if (this.pickupInstanced.instanceColor) {
      this.pickupInstanced.instanceColor.needsUpdate = true;
    }

    // 8. Update Particles InstancedMesh
    let ptCount = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;

      const lifeRatio = 1.0 - pt.age / pt.maxAge;
      this._dummy.position.set(pt.x, pt.y, pt.z);
      this._dummy.rotation.set(pt.age * 6, pt.age * 4, 0);
      this._dummy.scale.setScalar(pt.size * lifeRatio);
      this._dummy.updateMatrix();

      this.particleInstanced.setMatrixAt(ptCount, this._dummy.matrix);
      this._color.setRGB(pt.r, pt.g, pt.b);
      this.particleInstanced.setColorAt(ptCount, this._color);
      ptCount++;
    }
    this.particleInstanced.count = ptCount;
    this.particleInstanced.instanceMatrix.needsUpdate = true;
    if (this.particleInstanced.instanceColor) {
      this.particleInstanced.instanceColor.needsUpdate = true;
    }

    // 9. Update Camera Rig (Title orbit vs Third-Person Follow with FOV kick & wall pull-in)
    this.updateCameraRig(interpX, interpZ, realDt);

    // 10. Update Floating Damage Text DOM Overlays
    this.updateFloatingTextDom(realDt);
  }

  private updateCameraRig(playerX: number, playerZ: number, dt: number): void {
    const c = this.camState;
    c.trauma = Math.max(0, c.trauma - dt * 2.2);
    c.chromaticPulse = Math.max(0, c.chromaticPulse - dt * 0.08);

    if (this.customFxPass) {
      this.customFxPass.uniforms.chromaticAmount.value = c.chromaticPulse;
      const lowHpRatio =
        this.mode === 'playing' && this.player.hp / this.player.maxHp < 0.35
          ? 0.5 + 0.5 * Math.sin(performance.now() * 0.01)
          : 0.0;
      this.customFxPass.uniforms.dangerPulse.value = lowHpRatio;
    }

    if (this.mode === 'title') {
      c.titleAngle += dt * 0.22;
      const orbitR = 20.5;
      this.camera.position.set(
        Math.cos(c.titleAngle) * orbitR,
        11.5,
        Math.sin(c.titleAngle) * orbitR
      );
      this.camera.lookAt(0, 1.2, 0);
      return;
    }

    // Smooth follow with look-ahead toward aim point
    const aimOffsetX = THREE.MathUtils.clamp(
      (this.player.aimX - playerX) * 0.18,
      -CONFIG.CAMERA.LOOK_AHEAD,
      CONFIG.CAMERA.LOOK_AHEAD
    );
    const aimOffsetZ = THREE.MathUtils.clamp(
      (this.player.aimZ - playerZ) * 0.18,
      -CONFIG.CAMERA.LOOK_AHEAD,
      CONFIG.CAMERA.LOOK_AHEAD
    );

    const desiredLookX = playerX + aimOffsetX;
    const desiredLookZ = playerZ + aimOffsetZ;

    const dampFactor = 1.0 - Math.exp(-CONFIG.CAMERA.FOLLOW_DAMP * dt);
    c.lookX = THREE.MathUtils.lerp(c.lookX, desiredLookX, dampFactor);
    c.lookZ = THREE.MathUtils.lerp(c.lookZ, desiredLookZ, dampFactor);

    let desiredCamX = c.lookX;
    let desiredCamY = CONFIG.CAMERA.OFFSET_Y;
    let desiredCamZ = c.lookZ + CONFIG.CAMERA.OFFSET_Z;

    // Raycast from player anchor to camera to pull in before clipping pillars
    this._camOrigin.set(playerX, 1.5, playerZ);
    this._camRayDir
      .set(desiredCamX - playerX, desiredCamY - 1.5, desiredCamZ - playerZ);
    const fullDist = this._camRayDir.length();
    this._camRayDir.normalize();
    this._raycaster.set(this._camOrigin, this._camRayDir);
    this._raycaster.far = fullDist;

    const hits = this._raycaster.intersectObjects(this.world.cameraBlockers, false);
    if (hits.length > 0 && hits[0].distance < fullDist) {
      const pullDist = Math.max(5.0, hits[0].distance - 1.2);
      desiredCamX = playerX + this._camRayDir.x * pullDist;
      desiredCamY = 1.5 + this._camRayDir.y * pullDist;
      desiredCamZ = playerZ + this._camRayDir.z * pullDist;
    }

    c.x = THREE.MathUtils.lerp(c.x, desiredCamX, dampFactor);
    c.y = THREE.MathUtils.lerp(c.y, desiredCamY, dampFactor);
    c.z = THREE.MathUtils.lerp(c.z, desiredCamZ, dampFactor);

    // Decaying trauma^2 camera shake
    const shake = c.trauma * c.trauma * 0.75;
    const sx = (Math.random() * 2 - 1) * shake;
    const sy = (Math.random() * 2 - 1) * shake;
    const sz = (Math.random() * 2 - 1) * shake;

    this.camera.position.set(c.x + sx, c.y + sy, c.z + sz);
    this.camera.lookAt(c.lookX, 0.8, c.lookZ);

    // Subtle movement roll tilt + Dash FOV kick
    const targetTilt =
      (-this.player.vx / CONFIG.PLAYER.MAX_SPEED) * CONFIG.CAMERA.MOVE_TILT_MAX;
    c.tiltZ = THREE.MathUtils.lerp(c.tiltZ, targetTilt, dampFactor);
    this.camera.rotation.z += c.tiltZ;

    const targetFov =
      this.player.dashTimer > 0
        ? CONFIG.CAMERA.BASE_FOV + CONFIG.CAMERA.DASH_FOV_KICK
        : CONFIG.CAMERA.BASE_FOV;
    if (Math.abs(c.fov - targetFov) > 0.05) {
      c.fov = THREE.MathUtils.lerp(c.fov, targetFov, 1.0 - Math.exp(-14 * dt));
      this.camera.fov = c.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateFloatingTextDom(dt: number): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    for (let i = 0; i < this.floatingTexts.length; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;

      ft.age += dt;
      if (ft.age >= ft.maxAge) {
        ft.active = false;
        this.floatingDomPool[i].style.opacity = '0';
        continue;
      }

      ft.y += dt * 1.8;
      this._projVec.set(ft.x, ft.y, ft.z).project(this.camera);

      const dom = this.floatingDomPool[i];
      if (this._projVec.z >= -1 && this._projVec.z <= 1) {
        const sx = (this._projVec.x * 0.5 + 0.5) * width;
        const sy = (-this._projVec.y * 0.5 + 0.5) * height;
        const alpha = 1.0 - ft.age / ft.maxAge;
        dom.style.opacity = alpha.toFixed(2);
        dom.style.transform = `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0) translate(-50%, -50%)`;
      } else {
        dom.style.opacity = '0';
      }
    }
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = window.requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || !gl.fenceSync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick(): void {
    if (this.disposed) return;

    const nowMs = performance.now();
    const rawDt = Math.max(0.001, (nowMs - this.lastTimeMs) * 0.001);
    this.lastTimeMs = nowMs;
    const clampedDt = Math.min(rawDt, CONFIG.MAX_FRAME_DT);

    // FPS tracking & Dynamic Resolution Scaling
    this.fpsFrameCount++;
    this.fpsAccumTime += rawDt;
    if (this.fpsAccumTime >= 1.0) {
      this.currentFps = Math.round(this.fpsFrameCount / this.fpsAccumTime);
      this.fpsFrameCount = 0;
      this.fpsAccumTime = 0;

      if (!this.isSoftwareGl) {
        const preset = CONFIG.QUALITY_PRESETS[this.settings.quality];
        const maxPR = Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
        if (this.currentFps < 50 && this.dynamicPixelRatio > 0.75) {
          this.dynamicPixelRatio = Math.max(0.75, this.dynamicPixelRatio - 0.25);
          this.renderer.setPixelRatio(this.dynamicPixelRatio);
        } else if (this.currentFps >= 57 && this.dynamicPixelRatio < maxPR) {
          this.dynamicPixelRatio = Math.min(maxPR, this.dynamicPixelRatio + 0.25);
          this.renderer.setPixelRatio(this.dynamicPixelRatio);
        }
      }
    }

    if (this.mode === 'playing') {
      this.accumulator += clampedDt;
      while (this.accumulator >= CONFIG.FIXED_DT) {
        this.stepSimulation(CONFIG.FIXED_DT);
        this.keysJustPressed.clear();
        this.accumulator -= CONFIG.FIXED_DT;
      }
      const alpha = this.accumulator / CONFIG.FIXED_DT;
      this.updateVisualScene(alpha, clampedDt);
    } else {
      this.updateVisualScene(1.0, clampedDt);
    }

    if (this.isSoftwareGl || !this.composer) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }

    // Throttle React HUD updates (~10Hz)
    this.hudSyncCounter++;
    if (this.hudSyncCounter >= 6) {
      this.hudSyncCounter = 0;
      this.emitHudSnapshot();
    }

    this.scheduleNextFrame();
  }

  private emitHudSnapshot(): void {
    let bossAngle = 0;
    let bossOffscreen = false;
    if (this.boss.active) {
      this._projVec.set(this.boss.x, 1.5, this.boss.z).project(this.camera);
      bossOffscreen =
        Math.abs(this._projVec.x) > 0.92 ||
        Math.abs(this._projVec.y) > 0.92 ||
        this._projVec.z > 1;
      bossAngle = Math.atan2(-this._projVec.y, this._projVec.x);
    }

    const dashReadyRatio =
      this.player.dashCooldownTimer <= 0
        ? 1.0
        : 1.0 - this.player.dashCooldownTimer / this.playerStats.dashCooldown;

    this.onHudUpdate({
      mode: this.mode,
      hp: Math.ceil(this.player.hp),
      maxHp: Math.round(this.player.maxHp),
      xp: Math.round(this.player.xp),
      xpToNext: Math.round(this.player.xpToNext),
      level: this.player.level,
      wave: this.wave,
      waveBannerText: this.waveBannerText,
      score: this.score,
      highScore: this.highScore,
      comboCount: this.comboCount,
      comboMultiplier: calculateComboMultiplier(this.comboCount),
      comboTimerRatio: Math.max(0, this.comboTimer / CONFIG.COMBO.RESET_SECONDS),
      dashCooldownRatio: THREE.MathUtils.clamp(dashReadyRatio, 0, 1),
      kills: this.kills,
      elapsedSeconds: Math.floor(this.totalSimTime),
      shieldTimer: this.player.shieldTimer,
      slowTimeTimer: this.player.slowTimeTimer,
      fps: this.currentFps,
      upgradeChoices: this.currentUpgradeChoices,
      upgradeLevels: { ...this.upgradeLevels },
      tutorialStep: this.tutorialStep,
      boss: {
        active: this.boss.active,
        name: CONFIG.BOSS.name,
        hp: Math.max(0, Math.ceil(this.boss.hp)),
        maxHp: this.boss.maxHp,
        screenAngleRad: bossAngle,
        isOffscreen: bossOffscreen,
      },
    });
  }

  // Event Listeners
  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.sound.unlock();

    if (this.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      this.startNewRun();
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.mode === 'playing') {
        this.setMode('paused');
        return;
      } else if (this.mode === 'paused') {
        this.setMode('playing');
        return;
      }
    }

    this.keysHeld.add(e.code);
    this.keysJustPressed.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (document.pointerLockElement === this.renderer.domElement) {
      const sens = 0.0022 * this.settings.sensitivity;
      this.pointerNdc.x = THREE.MathUtils.clamp(
        this.pointerNdc.x + e.movementX * sens,
        -0.95,
        0.95
      );
      this.pointerNdc.y = THREE.MathUtils.clamp(
        this.pointerNdc.y - e.movementY * sens,
        -0.95,
        0.95
      );
    } else {
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    this.pointerActive = true;
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.sound.unlock();
    if (e.button === 0 && this.mode === 'playing') {
      this.mouseDown = true;
      this.onPointerMove(e);
      if (
        this.settings.pointerLock &&
        document.pointerLockElement !== this.renderer.domElement
      ) {
        this.renderer.domElement.requestPointerLock?.();
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private onBlur = (): void => {
    this.keysHeld.clear();
    this.keysJustPressed.clear();
    this.mouseDown = false;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.onBlur();
      if (this.mode === 'playing') {
        this.setMode('paused');
      }
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.mode === 'playing') this.setMode('paused');
    });
  }

  public dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pointerup', this.onPointerUp);

    this.sound.dispose();
    this.world.dispose();
    this.contactShadowTex.dispose();
    this.renderer.dispose();
  }
}
