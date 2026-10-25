export type QualityPreset = 'low' | 'medium' | 'high';

export type EnemyType =
  | 'chaser'
  | 'tank'
  | 'shooter'
  | 'splitter'
  | 'splitter_mini'
  | 'dasher';

export type PickupType = 'xp' | 'health' | 'shield' | 'nuke' | 'slow_time';

export type UpgradeId =
  | 'damage'
  | 'fire_rate'
  | 'multishot'
  | 'piercing'
  | 'ricochet'
  | 'max_hp'
  | 'regen'
  | 'dash_cooldown'
  | 'magnet_range'
  | 'crit_chance'
  | 'orbit_drone'
  | 'kill_explosion';

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  role: string;
  description: string;
  maxLevel: number;
  accentHex: string;
}

export const CONFIG = {
  TITLE: 'NEON SURVIVOR 3D',
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.05,

  ARENA: {
    PLAYABLE_RADIUS: 42,
    OUTER_CLIFF_RADIUS: 62,
    SPATIAL_HASH_CELL_SIZE: 4.5,
    PILLAR_COUNT: 8,
    PILLAR_RING_RADIUS: 22,
    PILLAR_RADIUS: 1.85,
    PLATFORM_COUNT: 4,
    PLATFORM_RING_RADIUS: 13,
    PLATFORM_RADIUS: 3.2,
  },

  PLAYER: {
    BASE_MAX_HP: 100,
    RADIUS: 0.85,
    MAX_SPEED: 11.5,
    ACCELERATION: 68.0,
    FRICTION: 12.5,
    DASH_SPEED: 29.0,
    DASH_DURATION: 0.18,
    DASH_COOLDOWN: 1.5,
    DASH_IFRAME: 0.22,
    HURT_IFRAME: 0.45,
    BASE_DAMAGE: 24,
    BASE_FIRE_RATE: 6.2, // shots per second
    BULLET_SPEED: 34.0,
    BULLET_LIFETIME: 1.6,
    BULLET_RADIUS: 0.28,
    BASE_MAGNET_RANGE: 6.0,
    BASE_CRIT_CHANCE: 0.08,
    CRIT_MULTIPLIER: 2.0,
    ORBIT_DRONE_RADIUS: 3.2,
    ORBIT_DRONE_FIRE_INTERVAL: 0.55,
    KILL_EXPLOSION_RADIUS: 4.2,
    KILL_EXPLOSION_DAMAGE_RATIO: 0.75,
  },

  CAMERA: {
    OFFSET_Y: 16.5,
    OFFSET_Z: 13.5,
    LOOK_AHEAD: 2.4,
    FOLLOW_DAMP: 9.5,
    BASE_FOV: 52,
    DASH_FOV_KICK: 7.0,
    MOVE_TILT_MAX: 0.045,
  },

  WAVE: {
    INTERMISSION_SECONDS: 3.0,
    BASE_ENEMY_COUNT: 9,
    ENEMY_COUNT_PER_WAVE: 4,
    HP_SCALE_PER_WAVE: 0.14,
    SPEED_SCALE_PER_WAVE: 0.03,
    MAX_ACTIVE_ENEMIES: 180,
    SPAWN_INTERVAL_BASE: 0.72,
    SPAWN_INTERVAL_MIN: 0.18,
    BOSS_WAVE_INTERVAL: 5,
    MAX_CONCURRENT_ATTACK_TOKENS: 4,
  },

  COMBO: {
    RESET_SECONDS: 3.0,
    MAX_MULTIPLIER: 8.0,
    STEP_PER_KILL: 0.25,
  },

  PROGRESSION: {
    BASE_XP_TO_LEVEL: 50,
    XP_GROWTH_FACTOR: 1.28,
    XP_PER_ORB_BASE: 12,
    PICKUP_DROP_CHANCE: 0.085,
    SHIELD_DURATION: 8.0,
    SLOW_TIME_DURATION: 6.0,
    SLOW_TIME_FACTOR: 0.42,
    HEALTH_PICKUP_AMOUNT: 30,
  },

  ENEMIES: {
    chaser: {
      name: 'Interceptor Drone',
      colorHex: 0x06b6d4, // Cyan
      emissiveHex: 0x00f0ff,
      hp: 42,
      speed: 8.8,
      radius: 0.75,
      contactDamage: 12,
      score: 25,
      xp: 12,
    },
    tank: {
      name: 'Goliath Juggernaut',
      colorHex: 0xd946ef, // Magenta
      emissiveHex: 0xf43f5e,
      hp: 195,
      speed: 4.3,
      radius: 1.35,
      contactDamage: 28,
      score: 70,
      xp: 30,
    },
    shooter: {
      name: 'Pulse Artillery',
      colorHex: 0xfacc15, // Yellow
      emissiveHex: 0xf59e0b,
      hp: 65,
      speed: 5.8,
      radius: 0.85,
      contactDamage: 10,
      preferredRange: 14.5,
      fireInterval: 2.1,
      windupDuration: 0.45,
      projectileSpeed: 15.5,
      projectileDamage: 16,
      score: 45,
      xp: 18,
    },
    splitter: {
      name: 'Mitosis Prism',
      colorHex: 0x22c55e, // Green
      emissiveHex: 0x10b981,
      hp: 82,
      speed: 6.2,
      radius: 1.0,
      contactDamage: 15,
      splitCount: 3,
      score: 50,
      xp: 20,
    },
    splitter_mini: {
      name: 'Prism Shard',
      colorHex: 0x4ade80,
      emissiveHex: 0x34d399,
      hp: 26,
      speed: 10.2,
      radius: 0.52,
      contactDamage: 8,
      score: 15,
      xp: 6,
    },
    dasher: {
      name: 'Vanguard Striker',
      colorHex: 0xef4444, // Red
      emissiveHex: 0xfb7185,
      hp: 90,
      speed: 6.6,
      radius: 0.9,
      contactDamage: 22,
      chargeTriggerRange: 13.0,
      telegraphDuration: 0.68,
      chargeSpeed: 24.5,
      chargeDuration: 0.45,
      chargeCooldown: 2.8,
      score: 65,
      xp: 24,
    },
  },

  BOSS: {
    name: 'OMEGA CORE ARCHITECT',
    colorHex: 0xf43f5e,
    emissiveHex: 0xff1e56,
    baseHp: 1400,
    hpPerBossTier: 950,
    speed: 4.6,
    radius: 2.6,
    contactDamage: 34,
    score: 1000,
    xp: 220,
    phaseCycleSeconds: 4.5,
    radialBulletCount: 16,
    radialBulletSpeed: 14.0,
    radialBulletDamage: 18,
    slamRadius: 9.0,
    slamTelegraphDuration: 0.85,
    slamDamage: 36,
    summonCount: 4,
  },

  QUALITY_PRESETS: {
    low: {
      maxPixelRatio: 1.0,
      shadows: false,
      shadowMapSize: 512,
      bloom: false,
      bloomStrength: 0,
      maxParticles: 180,
    },
    medium: {
      maxPixelRatio: 1.5,
      shadows: true,
      shadowMapSize: 1024,
      bloom: true,
      bloomStrength: 0.55,
      maxParticles: 400,
    },
    high: {
      maxPixelRatio: 2.0,
      shadows: true,
      shadowMapSize: 2048,
      bloom: true,
      bloomStrength: 0.82,
      maxParticles: 650,
    },
  },

  UPGRADES: [
    {
      id: 'damage',
      name: 'Overclocked Core',
      role: 'Offense · +25% Weapon Damage',
      description: 'Increases primary pulse rifle and explosion damage by 25% per rank.',
      maxLevel: 6,
      accentHex: '#06B6D4',
    },
    {
      id: 'fire_rate',
      name: 'Rapid Cycling',
      role: 'Cadence · +20% Fire Rate',
      description: 'Accelerates weapon chamber cycling speed by 20% per rank.',
      maxLevel: 6,
      accentHex: '#38BDF8',
    },
    {
      id: 'multishot',
      name: 'Split Barrel Array',
      role: 'Spread · +1 Projectile Per Shot',
      description: 'Fires an additional plasma bolt in a calibrated spread arc.',
      maxLevel: 4,
      accentHex: '#F59E0B',
    },
    {
      id: 'piercing',
      name: 'Phase Tungsten Rounds',
      role: 'Penetration · +1 Enemy Pierce',
      description: 'Projectiles slice through an additional hostile target before dissipating.',
      maxLevel: 4,
      accentHex: '#10B981',
    },
    {
      id: 'ricochet',
      name: 'Vector Ricochet',
      role: 'Bounce · +1 Target / Wall Bounce',
      description: 'Bolts deflect off arena barriers and chain toward nearby hostiles.',
      maxLevel: 4,
      accentHex: '#A855F7',
    },
    {
      id: 'max_hp',
      name: 'Titanium Chassis',
      role: 'Defense · +30 Max HP & Instant Heal',
      description: 'Reinforces hull integrity by +30 Max HP and restores 30 HP immediately.',
      maxLevel: 5,
      accentHex: '#22C55E',
    },
    {
      id: 'regen',
      name: 'Nanite Repair Matrix',
      role: 'Sustain · +2.5 HP/sec Regeneration',
      description: 'Continuously reconstructs damaged armor plating during combat.',
      maxLevel: 5,
      accentHex: '#4ADE80',
    },
    {
      id: 'dash_cooldown',
      name: 'Thruster Capacitor',
      role: 'Mobility · -18% Dash Cooldown',
      description: 'Reduces phase-dash recharge time and extends i-frame window.',
      maxLevel: 4,
      accentHex: '#0EA5E9',
    },
    {
      id: 'magnet_range',
      name: 'Graviton Attractor',
      role: 'Utility · +45% Energy Magnet Radius',
      description: 'Pulls distant XP orbs and supply pickups toward your mech.',
      maxLevel: 4,
      accentHex: '#EAB308',
    },
    {
      id: 'crit_chance',
      name: 'Target Lock Optics',
      role: 'Precision · +12% Critical Strike Chance',
      description: 'Increases probability of dealing 2.0x critical damage on impact.',
      maxLevel: 5,
      accentHex: '#F43F5E',
    },
    {
      id: 'orbit_drone',
      name: 'Sentinel Orbit Drone',
      role: 'Companion · +1 Autonomous Turret Drone',
      description: 'Deploys an orbiting sentinel drone that automatically fires at nearby enemies.',
      maxLevel: 4,
      accentHex: '#8B5CF6',
    },
    {
      id: 'kill_explosion',
      name: 'Volatile Chain Detonation',
      role: 'Area Blast · Enemies Explode on Death',
      description: 'Destroyed hostiles detonate in a neon shockwave damaging nearby foes.',
      maxLevel: 4,
      accentHex: '#FB923C',
    },
  ] as UpgradeDefinition[],
} as const;
