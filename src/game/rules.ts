import { CONFIG, EnemyType, UpgradeDefinition, UpgradeId } from './config';

export interface ObstacleCircle {
  x: number;
  z: number;
  radius: number;
}

export type UpgradeLevels = Record<UpgradeId, number>;

export interface ComputedPlayerStats {
  maxHp: number;
  damage: number;
  fireRate: number;
  multishot: number;
  piercing: number;
  ricochet: number;
  regenPerSec: number;
  dashCooldown: number;
  magnetRange: number;
  critChance: number;
  orbitDroneCount: number;
  killExplosionLevel: number;
}

export interface WaveConfig {
  wave: number;
  totalEnemies: number;
  hpMultiplier: number;
  speedMultiplier: number;
  spawnInterval: number;
  isBossWave: boolean;
  bossHp: number;
  weights: Record<Exclude<EnemyType, 'splitter_mini'>, number>;
}

export function createEmptyUpgradeLevels(): UpgradeLevels {
  return {
    damage: 0,
    fire_rate: 0,
    multishot: 0,
    piercing: 0,
    ricochet: 0,
    max_hp: 0,
    regen: 0,
    dash_cooldown: 0,
    magnet_range: 0,
    crit_chance: 0,
    orbit_drone: 0,
    kill_explosion: 0,
  };
}

export function computePlayerStats(levels: UpgradeLevels): ComputedPlayerStats {
  const maxHp = CONFIG.PLAYER.BASE_MAX_HP + levels.max_hp * 30;
  const damage = Math.round(CONFIG.PLAYER.BASE_DAMAGE * (1 + levels.damage * 0.25));
  const fireRate = CONFIG.PLAYER.BASE_FIRE_RATE * (1 + levels.fire_rate * 0.2);
  const multishot = 1 + levels.multishot;
  const piercing = levels.piercing;
  const ricochet = levels.ricochet;
  const regenPerSec = levels.regen * 2.5;
  const dashCooldown = Math.max(
    0.45,
    CONFIG.PLAYER.DASH_COOLDOWN * Math.pow(0.82, levels.dash_cooldown)
  );
  const magnetRange = CONFIG.PLAYER.BASE_MAGNET_RANGE * (1 + levels.magnet_range * 0.45);
  const critChance = Math.min(0.85, CONFIG.PLAYER.BASE_CRIT_CHANCE + levels.crit_chance * 0.12);
  const orbitDroneCount = levels.orbit_drone;
  const killExplosionLevel = levels.kill_explosion;

  return {
    maxHp,
    damage,
    fireRate,
    multishot,
    piercing,
    ricochet,
    regenPerSec,
    dashCooldown,
    magnetRange,
    critChance,
    orbitDroneCount,
    killExplosionLevel,
  };
}

export function pickUpgradeChoices(
  levels: UpgradeLevels,
  count = 3,
  rng: () => number = Math.random
): UpgradeDefinition[] {
  const available = CONFIG.UPGRADES.filter((u) => (levels[u.id] ?? 0) < u.maxLevel);
  if (available.length <= count) {
    return [...available];
  }
  const pool = [...available];
  const chosen: UpgradeDefinition[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return chosen;
}

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(1, level);
  return Math.round(
    CONFIG.PROGRESSION.BASE_XP_TO_LEVEL *
      Math.pow(CONFIG.PROGRESSION.XP_GROWTH_FACTOR, safeLevel - 1)
  );
}

export function calculateComboMultiplier(comboCount: number): number {
  if (comboCount <= 1) return 1.0;
  return Math.min(
    CONFIG.COMBO.MAX_MULTIPLIER,
    1.0 + (comboCount - 1) * CONFIG.COMBO.STEP_PER_KILL
  );
}

export function calculateKillScore(basePoints: number, comboCount: number): number {
  const mult = calculateComboMultiplier(comboCount);
  return Math.round(basePoints * mult);
}

export function getWaveConfig(wave: number): WaveConfig {
  const safeWave = Math.max(1, wave);
  const totalEnemies =
    CONFIG.WAVE.BASE_ENEMY_COUNT + (safeWave - 1) * CONFIG.WAVE.ENEMY_COUNT_PER_WAVE;
  const hpMultiplier = 1 + (safeWave - 1) * CONFIG.WAVE.HP_SCALE_PER_WAVE;
  const speedMultiplier = Math.min(1.65, 1 + (safeWave - 1) * CONFIG.WAVE.SPEED_SCALE_PER_WAVE);
  const spawnInterval = Math.max(
    CONFIG.WAVE.SPAWN_INTERVAL_MIN,
    CONFIG.WAVE.SPAWN_INTERVAL_BASE - (safeWave - 1) * 0.04
  );
  const isBossWave = safeWave % CONFIG.WAVE.BOSS_WAVE_INTERVAL === 0;
  const bossTier = Math.max(1, Math.floor(safeWave / CONFIG.WAVE.BOSS_WAVE_INTERVAL));
  const bossHp = Math.round(
    CONFIG.BOSS.baseHp + (bossTier - 1) * CONFIG.BOSS.hpPerBossTier
  );

  // Progressive enemy archetype mix across waves
  const weights: Record<Exclude<EnemyType, 'splitter_mini'>, number> = {
    chaser: 45,
    shooter: safeWave >= 1 ? 20 : 0,
    tank: safeWave >= 2 ? 15 + Math.min(20, safeWave * 2) : 8,
    splitter: safeWave >= 2 ? 16 + Math.min(18, safeWave * 2) : 6,
    dasher: safeWave >= 3 ? 16 + Math.min(20, safeWave * 2) : 6,
  };

  return {
    wave: safeWave,
    totalEnemies,
    hpMultiplier,
    speedMultiplier,
    spawnInterval,
    isBossWave,
    bossHp,
    weights,
  };
}

export function pickWeightedEnemyType(
  weights: Record<Exclude<EnemyType, 'splitter_mini'>, number>,
  rng: () => number = Math.random
): Exclude<EnemyType, 'splitter_mini'> {
  const entries = Object.entries(weights) as [Exclude<EnemyType, 'splitter_mini'>, number][];
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    total += entries[i][1];
  }
  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= entries[i][1];
    if (roll <= 0) {
      return entries[i][0];
    }
  }
  return 'chaser';
}

export function resolveCircleObstacleCollision(
  x: number,
  z: number,
  radius: number,
  obstacles: readonly ObstacleCircle[],
  arenaRadius: number
): { x: number; z: number; hitBoundary: boolean; normalX: number; normalZ: number } {
  let outX = x;
  let outZ = z;
  let hitBoundary = false;
  let normalX = 0;
  let normalZ = 0;

  // Check circular obstacles (pillars)
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const dx = outX - obs.x;
    const dz = outZ - obs.z;
    const minDist = radius + obs.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const nx = dx / dist;
      const nz = dz / dist;
      outX = obs.x + nx * minDist;
      outZ = obs.z + nz * minDist;
      hitBoundary = true;
      normalX = nx;
      normalZ = nz;
    }
  }

  // Clamp inside circular playable arena perimeter
  const maxDist = Math.max(0.5, arenaRadius - radius);
  const distFromCenterSq = outX * outX + outZ * outZ;
  if (distFromCenterSq > maxDist * maxDist) {
    const dist = Math.sqrt(distFromCenterSq) || 0.0001;
    normalX = -outX / dist;
    normalZ = -outZ / dist;
    outX = (outX / dist) * maxDist;
    outZ = (outZ / dist) * maxDist;
    hitBoundary = true;
  }

  return { x: outX, z: outZ, hitBoundary, normalX, normalZ };
}

/**
 * Zero-GC Spatial Hash 2D on the XZ plane for high-count circle collision queries.
 */
export class SpatialHash2D {
  private cellSize: number;
  private buckets: Map<number, number[]>;
  private pool: number[][];
  private queryResult: number[];

  constructor(cellSize = CONFIG.ARENA.SPATIAL_HASH_CELL_SIZE) {
    this.cellSize = cellSize;
    this.buckets = new Map();
    this.pool = [];
    this.queryResult = [];
  }

  private hashCoords(cx: number, cz: number): number {
    // Pack signed 16-bit cell coordinates into a single integer key
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  clear(): void {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
      this.pool.push(bucket);
    }
    this.buckets.clear();
  }

  insert(id: number, x: number, z: number, radius: number): void {
    const cs = this.cellSize;
    const minX = Math.floor((x - radius) / cs);
    const maxX = Math.floor((x + radius) / cs);
    const minZ = Math.floor((z - radius) / cs);
    const maxZ = Math.floor((z + radius) / cs);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = this.hashCoords(cx, cz);
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = this.pool.pop() || [];
          this.buckets.set(key, bucket);
        }
        bucket.push(id);
      }
    }
  }

  query(x: number, z: number, radius: number): readonly number[] {
    this.queryResult.length = 0;
    const cs = this.cellSize;
    const minX = Math.floor((x - radius) / cs);
    const maxX = Math.floor((x + radius) / cs);
    const minZ = Math.floor((z - radius) / cs);
    const maxZ = Math.floor((z + radius) / cs);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const bucket = this.buckets.get(this.hashCoords(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i];
          if (!this.queryResult.includes(id)) {
            this.queryResult.push(id);
          }
        }
      }
    }
    return this.queryResult;
  }
}
