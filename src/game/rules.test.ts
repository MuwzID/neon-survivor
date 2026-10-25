import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpatialHash2D,
  calculateComboMultiplier,
  calculateKillScore,
  computePlayerStats,
  createEmptyUpgradeLevels,
  getWaveConfig,
  pickUpgradeChoices,
  resolveCircleObstacleCollision,
  xpRequiredForLevel,
} from './rules';
import { CONFIG } from './config';

test('all 12 upgrades exist and computePlayerStats scales correctly', () => {
  assert.equal(CONFIG.UPGRADES.length, 12);
  const levels = createEmptyUpgradeLevels();
  const base = computePlayerStats(levels);
  assert.equal(base.maxHp, 100);
  assert.equal(base.multishot, 1);
  assert.equal(base.orbitDroneCount, 0);

  levels.damage = 2;
  levels.max_hp = 2;
  levels.multishot = 2;
  levels.orbit_drone = 3;
  levels.dash_cooldown = 2;
  const boosted = computePlayerStats(levels);
  assert.equal(boosted.maxHp, 160);
  assert.ok(boosted.damage > base.damage);
  assert.equal(boosted.multishot, 3);
  assert.equal(boosted.orbitDroneCount, 3);
  assert.ok(boosted.dashCooldown < base.dashCooldown);
});

test('pickUpgradeChoices returns 3 distinct non-maxed upgrades', () => {
  const levels = createEmptyUpgradeLevels();
  const choices = pickUpgradeChoices(levels, 3, () => 0.3);
  assert.equal(choices.length, 3);
  const ids = new Set(choices.map((c) => c.id));
  assert.equal(ids.size, 3);
});

test('wave config triggers boss every 5th wave and scales difficulty', () => {
  const w1 = getWaveConfig(1);
  const w5 = getWaveConfig(5);
  const w10 = getWaveConfig(10);

  assert.equal(w1.isBossWave, false);
  assert.equal(w5.isBossWave, true);
  assert.equal(w10.isBossWave, true);
  assert.ok(w5.totalEnemies > w1.totalEnemies);
  assert.ok(w5.hpMultiplier > w1.hpMultiplier);
  assert.ok(w10.bossHp > w5.bossHp);
});

test('combo multiplier and score calculation cap properly', () => {
  assert.equal(calculateComboMultiplier(1), 1.0);
  assert.equal(calculateComboMultiplier(5), 2.0);
  assert.equal(calculateComboMultiplier(100), CONFIG.COMBO.MAX_MULTIPLIER);
  assert.equal(calculateKillScore(50, 5), 100);
});

test('xpRequiredForLevel increases monotonically', () => {
  const l1 = xpRequiredForLevel(1);
  const l2 = xpRequiredForLevel(2);
  const l5 = xpRequiredForLevel(5);
  assert.ok(l2 > l1);
  assert.ok(l5 > l2);
});

test('SpatialHash2D inserts and queries nearby entities accurately', () => {
  const hash = new SpatialHash2D(4.0);
  hash.insert(10, 0, 0, 1.0);
  hash.insert(20, 2.5, 1.0, 1.0);
  hash.insert(30, 35.0, -35.0, 1.0);

  const nearOrigin = hash.query(1.0, 0.5, 2.0);
  assert.ok(nearOrigin.includes(10));
  assert.ok(nearOrigin.includes(20));
  assert.ok(!nearOrigin.includes(30));

  hash.clear();
  assert.equal(hash.query(0, 0, 5.0).length, 0);
});

test('resolveCircleObstacleCollision pushes out of pillar and clamps to arena radius', () => {
  const obstacles = [{ x: 5, z: 0, radius: 2.0 }];
  const hitPillar = resolveCircleObstacleCollision(6.0, 0, 1.0, obstacles, 40);
  assert.equal(hitPillar.hitBoundary, true);
  assert.ok(Math.abs(hitPillar.x - 8.0) < 0.001);

  const hitWall = resolveCircleObstacleCollision(45.0, 0, 1.0, obstacles, 40);
  assert.equal(hitWall.hitBoundary, true);
  assert.ok(Math.abs(hitWall.x - 39.0) < 0.001);
});

import { createEnemyArchetypeGeometry } from './models';
import { EnemyType } from './config';

test('all 6 enemy archetype procedural geometries merge cleanly without null', () => {
  const types: EnemyType[] = [
    'chaser',
    'tank',
    'shooter',
    'splitter',
    'splitter_mini',
    'dasher',
  ];
  for (const t of types) {
    const geo = createEnemyArchetypeGeometry(t);
    assert.ok(geo, `Geometry for ${t} should not be null`);
    assert.ok(geo.getAttribute('position').count > 0, `Geometry for ${t} has vertices`);
    assert.ok(geo.getAttribute('normal').count > 0, `Geometry for ${t} has normals`);
  }
});
