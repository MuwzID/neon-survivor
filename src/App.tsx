import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CONFIG, QualityPreset, UpgradeId } from './game/config';
import { createEmptyUpgradeLevels } from './game/rules';
import {
  DEFAULT_SETTINGS,
  GameSettings,
  loadSavedData,
  saveGameData,
} from './game/storage';
import { HudSnapshot, NeonSurvivorEngine } from './game/engine';

const INITIAL_HUD: HudSnapshot = {
  mode: 'title',
  hp: 100,
  maxHp: 100,
  xp: 0,
  xpToNext: 50,
  level: 1,
  wave: 1,
  waveBannerText: null,
  score: 0,
  highScore: 0,
  comboCount: 0,
  comboMultiplier: 1.0,
  comboTimerRatio: 0,
  dashCooldownRatio: 1.0,
  kills: 0,
  elapsedSeconds: 0,
  shieldTimer: 0,
  slowTimeTimer: 0,
  fps: 60,
  upgradeChoices: [],
  upgradeLevels: createEmptyUpgradeLevels(),
  tutorialStep: 0,
  boss: {
    active: false,
    name: CONFIG.BOSS.name,
    hp: 1400,
    maxHp: 1400,
    screenAngleRad: 0,
    isOffscreen: false,
  },
};

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const floatingTextRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<NeonSurvivorEngine | null>(null);

  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(() => {
    const saved = loadSavedData();
    return {
      ...INITIAL_HUD,
      highScore: saved.highScore,
      tutorialStep: saved.tutorialDone ? 3 : 0,
    };
  });

  const [settings, setSettings] = useState<GameSettings>(() => loadSavedData().settings);
  const [bestWave, setBestWave] = useState<number>(() => loadSavedData().bestWave);
  const [isNewHighScore, setIsNewHighScore] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showHowToPlayModal, setShowHowToPlayModal] = useState<boolean>(false);
  const [trailingHpRatio, setTrailingHpRatio] = useState<number>(1.0);

  // Mobile virtual joystick state
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const joystickPointerId = useRef<number | null>(null);
  const [joystickOffset, setJoystickOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Trailing damage ghost bar effect
  const currentHpRatio = Math.max(0, Math.min(1, hud.hp / Math.max(1, hud.maxHp)));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTrailingHpRatio(currentHpRatio);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [currentHpRatio]);

  // Persist high score, best wave, and tutorial completion
  useEffect(() => {
    const saved = loadSavedData();
    if (hud.score > saved.highScore) {
      setIsNewHighScore(true);
      saveGameData({ highScore: hud.score });
    }
    if (hud.wave > saved.bestWave) {
      setBestWave(hud.wave);
      saveGameData({ bestWave: hud.wave });
    }
    if (hud.tutorialStep >= 3 && !saved.tutorialDone) {
      saveGameData({ tutorialDone: true });
    }
  }, [hud.score, hud.wave, hud.tutorialStep]);

  // Mount Three.js engine once
  useEffect(() => {
    if (!canvasMountRef.current || !floatingTextRef.current) return;

    const saved = loadSavedData();
    try {
      const testCanvas = document.createElement('canvas');
      const gl =
        testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) {
        setWebglError(
          'WebGL is not supported or is disabled in your browser. Please enable hardware acceleration to play NEON SURVIVOR 3D.'
        );
        return;
      }
    } catch {
      setWebglError('Unable to initialize WebGL graphics context.');
      return;
    }

    const engine = new NeonSurvivorEngine(
      canvasMountRef.current,
      floatingTextRef.current,
      saved.settings,
      saved.highScore,
      saved.tutorialDone,
      (snapshot) => {
        setHud(snapshot);
      },
      (progress) => {
        setLoadingProgress(progress);
      }
    );
    engineRef.current = engine;

    // Support ?autostart=1 query param
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.startNewRun();
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Keyboard shortcuts for level-up cards (1, 2, 3) and Mute (M)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        setSettings((prev) => {
          const next = { ...prev, muted: !prev.muted };
          saveGameData({ settings: next });
          engineRef.current?.updateSettings(next);
          return next;
        });
      }
      if (hud.mode === 'levelup') {
        if (e.code === 'Digit1' && hud.upgradeChoices[0]) {
          engineRef.current?.selectUpgrade(hud.upgradeChoices[0].id);
        } else if (e.code === 'Digit2' && hud.upgradeChoices[1]) {
          engineRef.current?.selectUpgrade(hud.upgradeChoices[1].id);
        } else if (e.code === 'Digit3' && hud.upgradeChoices[2]) {
          engineRef.current?.selectUpgrade(hud.upgradeChoices[2].id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hud.mode, hud.upgradeChoices]);

  const handleStartGame = useCallback(
    (e?: React.MouseEvent<HTMLButtonElement>) => {
      e?.currentTarget.blur();
      setIsNewHighScore(false);
      setShowSettingsModal(false);
      setShowHowToPlayModal(false);
      engineRef.current?.startNewRun();
    },
    []
  );

  const handleUpdateSetting = useCallback(
    <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveGameData({ settings: next });
        engineRef.current?.updateSettings(next);
        return next;
      });
    },
    []
  );

  // Virtual Joystick Handlers (Mobile multi-touch safe)
  const handleJoystickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    joystickPointerId.current = e.pointerId;
    updateJoystickFromEvent(e);
  };

  const handleJoystickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    updateJoystickFromEvent(e);
  };

  const handleJoystickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joystickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    joystickPointerId.current = null;
    setJoystickOffset({ x: 0, y: 0 });
    engineRef.current?.setMobileInput(0, 0, false);
  };

  const updateJoystickFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = rect.width * 0.42;

    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    setJoystickOffset({ x: dx, y: dy });
    engineRef.current?.setMobileInput(dx / maxR, dy / maxR, true);
  };

  const xpRatio = Math.max(0, Math.min(1, hud.xp / Math.max(1, hud.xpToNext)));

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#05070e] select-none">
      {/* Isolated WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        data-testid="webgl-canvas-container"
        className="absolute inset-0 w-full h-full"
      />

      {/* Pooled Floating Damage Numbers Overlay */}
      <div
        ref={floatingTextRef}
        className="fixed inset-0 pointer-events-none z-10 overflow-hidden"
      />

      {/* WebGL Fallback Error Message */}
      {webglError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#05070e]">
          <div className="hud-panel max-w-md w-full p-6 rounded-xl text-center">
            <h1 className="font-display text-2xl font-bold text-rose-400 mb-3">
              Graphics Context Unavailable
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">{webglError}</p>
          </div>
        </div>
      )}

      {/* Loading Screen */}
      {loadingProgress < 100 && !webglError && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#05070e] px-6">
          <div className="w-full max-w-sm">
            <div className="flex items-center justify-between text-xs font-mono-num text-cyan-400 mb-2">
              <span>SYNTHESIZING 3D ARENA & SHADERS</span>
              <span>{loadingProgress}%</span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-cyan-500/30">
              <div
                className="h-full bg-cyan-400 transition-all duration-150"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ TITLE SCREEN ═══════════════ */}
      {hud.mode === 'title' && loadingProgress >= 100 && (
        <section
          aria-label="Title Screen"
          className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 md:p-12"
        >
          {/* Top-Right High Score Readout */}
          <div className="flex items-start justify-between w-full">
            <div className="text-xs font-mono-num tracking-widest text-cyan-400/90 uppercase">
              SECTOR 09 · ORBITAL ARENA
            </div>
            <div className="hud-panel px-4 py-2.5 rounded-lg pointer-events-auto text-right">
              <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                HIGH SCORE · BEST WAVE
              </div>
              <div className="font-mono-num text-xl font-bold text-cyan-300">
                {hud.highScore.toLocaleString()} <span className="text-slate-500">·</span>{' '}
                <span className="text-amber-400">W{bestWave}</span>
              </div>
            </div>
          </div>

          {/* Left-Third Asymmetric Title Lockup & Menu Actions over Calm Negative Space */}
          <div className="my-auto max-w-lg pointer-events-auto">
            {/* Bespoke Inline SVG Title Emblem */}
            <div className="mb-6">
              <svg
                viewBox="0 0 560 130"
                className="w-full max-w-[480px] h-auto drop-shadow-[0_6px_24px_rgba(6,182,212,0.35)]"
                role="img"
                aria-label="NEON SURVIVOR 3D"
              >
                <defs>
                  <linearGradient id="neonCyan" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="55%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#f59e0b" />
                  </linearGradient>
                </defs>
                {/* Armored geometric crest frame */}
                <polygon
                  points="8,22 28,6 532,6 552,22 552,108 532,124 28,124 8,108"
                  fill="rgba(8, 12, 24, 0.85)"
                  stroke="url(#neonCyan)"
                  strokeWidth="2.5"
                />
                <polyline
                  points="18,34 18,18 46,18"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="3"
                />
                <polyline
                  points="542,96 542,112 514,112"
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="3"
                />
                {/* Main Title Typography */}
                <text
                  x="32"
                  y="66"
                  fill="#f8fafc"
                  fontFamily="Oxanium, sans-serif"
                  fontWeight="800"
                  fontSize="44"
                  letterSpacing="3"
                >
                  NEON SURVIVOR
                </text>
                <text
                  x="34"
                  y="104"
                  fill="#38bdf8"
                  fontFamily="Oxanium, sans-serif"
                  fontWeight="700"
                  fontSize="22"
                  letterSpacing="8"
                >
                  ARENA OVERDRIVE 3D
                </text>
                {/* Hex emblem icon on right */}
                <polygon
                  points="504,44 524,55 524,78 504,89 484,78 484,55"
                  fill="rgba(6, 182, 212, 0.18)"
                  stroke="#38bdf8"
                  strokeWidth="2"
                />
                <circle cx="504" cy="66.5" r="6" fill="#f59e0b" />
              </svg>
            </div>

            <p className="text-sm md:text-base text-slate-300 mb-7 max-w-md leading-relaxed">
              Pilot an experimental pulse-mech trapped inside a high-voltage orbital
              arena. Harvest energy cores, evolve 12 weapon systems, and survive
              relentless machine waves.
            </p>

            {/* Primary CTA + Secondary Menu Buttons (3 actions total) */}
            <div className="flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                data-start="true"
                onClick={handleStartGame}
                className="px-7 py-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 active:translate-y-0.5 text-slate-950 font-display font-bold text-base tracking-wider uppercase transition-all cursor-pointer shadow-[0_0_24px_rgba(6,182,212,0.45)] whitespace-nowrap shrink-0"
              >
                Deploy Mech [Enter]
              </button>

              <button
                type="button"
                onClick={() => setShowHowToPlayModal(true)}
                className="px-5 py-3.5 rounded-lg hud-panel hover:border-cyan-400/60 text-slate-100 font-display font-semibold text-sm tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                How to Play
              </button>

              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="px-5 py-3.5 rounded-lg hud-panel hover:border-cyan-400/60 text-slate-100 font-display font-semibold text-sm tracking-wider uppercase transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Settings
              </button>
            </div>
          </div>

          {/* Flat Single-Line Control Hint in Bottom Safe Margin */}
          <div className="text-xs font-mono-num text-slate-400 tracking-wide">
            WASD Move · Mouse Aim &amp; Left-Click Fire · Space Phase Dash · P / Esc Pause
          </div>
        </section>
      )}

      {/* ═══════════════ PLAYING HUD (Low-Occlusion Perimeter Clusters) ═══════════════ */}
      {(hud.mode === 'playing' || hud.mode === 'levelup' || hud.mode === 'paused') && (
        <section
          aria-label="Gameplay HUD"
          className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-4 md:p-6"
        >
          {/* Top Perimeter Wrapper */}
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2 sm:gap-4 w-full">
              {/* Top-Left Cluster: Vitality, XP/Level, Dash Cooldown */}
              <div className="hud-panel rounded-xl p-2.5 sm:p-3.5 w-48 sm:w-64 md:w-72 pointer-events-auto shrink-0">
                {/* HP Bar with Delayed Damage Ghost Bar */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400 shrink-0"
                      fill="currentColor"
                    >
                      <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm1 14h-2v-3H8v-2h3V8h2v3h3v2h-3v3z" />
                    </svg>
                    <span className="text-[10px] sm:text-[11px] font-bold tracking-wider uppercase text-slate-300">
                      HULL HP
                    </span>
                  </div>
                  <span className="font-mono-num text-xs sm:text-sm font-bold text-slate-100 whitespace-nowrap">
                    {hud.hp} <span className="text-slate-500">/</span> {hud.maxHp}
                  </span>
                </div>
                <div className="relative w-full h-2.5 sm:h-3 bg-slate-950 rounded overflow-hidden border border-slate-800 mb-2">
                  {/* Trailing damage bar */}
                  <div
                    className="absolute inset-y-0 left-0 bg-amber-400/70 transition-all duration-300"
                    style={{ width: `${trailingHpRatio * 100}%` }}
                  />
                  {/* Actual HP bar */}
                  <div
                    className={`relative h-full transition-all duration-75 ${
                      currentHpRatio < 0.3 ? 'bg-rose-500' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${currentHpRatio * 100}%` }}
                  />
                </div>

                {/* XP & Level Bar */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[10px] sm:text-[11px] font-bold tracking-wider uppercase text-cyan-300 whitespace-nowrap">
                    LVL {hud.level} CORE
                  </span>
                  <span className="font-mono-num text-[10px] sm:text-xs text-slate-300 whitespace-nowrap">
                    {hud.xp} / {hud.xpToNext} XP
                  </span>
                </div>
                <div className="w-full h-1.5 sm:h-2 bg-slate-950 rounded overflow-hidden border border-slate-800 mb-2">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-100"
                    style={{ width: `${xpRatio * 100}%` }}
                  />
                </div>

                {/* Dash Thruster Cooldown + Active Buffs */}
                <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px]">
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3.5 h-3.5 text-sky-400 shrink-0"
                      fill="currentColor"
                    >
                      <path d="M13 2L3 14h7v8l10-12h-7z" />
                    </svg>
                    <span className="font-semibold tracking-wider text-slate-300 uppercase">
                      DASH
                    </span>
                  </div>
                  <span
                    className={`font-mono-num font-bold whitespace-nowrap ${
                      hud.dashCooldownRatio >= 0.99 ? 'text-cyan-300' : 'text-amber-400'
                    }`}
                  >
                    {hud.dashCooldownRatio >= 0.99
                      ? 'READY [SPACE]'
                      : `${Math.round(hud.dashCooldownRatio * 100)}%`}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-950 rounded overflow-hidden mt-1">
                  <div
                    className="h-full bg-sky-400 transition-all duration-75"
                    style={{ width: `${hud.dashCooldownRatio * 100}%` }}
                  />
                </div>

                {/* Temporary Pickup Buff Timers */}
                {(hud.shieldTimer > 0 || hud.slowTimeTimer > 0) && (
                  <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-slate-800 text-[10px] sm:text-xs font-mono-num">
                    {hud.shieldTimer > 0 && (
                      <span className="text-sky-300">
                        AEGIS {hud.shieldTimer.toFixed(1)}s
                      </span>
                    )}
                    {hud.slowTimeTimer > 0 && (
                      <span className="text-purple-300">
                        CHRONO {hud.slowTimeTimer.toFixed(1)}s
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Desktop Top-Center: Boss Health Bar & Wave Banner */}
              <div className="hidden md:flex flex-col items-center flex-1 max-w-md mx-auto">
                {hud.boss.active && (
                  <div className="hud-panel-danger w-full px-4 py-2.5 rounded-xl mb-2.5">
                    <div className="flex items-center justify-between text-xs font-display font-bold tracking-widest text-rose-300 uppercase mb-1">
                      <span>{hud.boss.name}</span>
                      <span className="font-mono-num">
                        {hud.boss.hp} / {hud.boss.maxHp}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-950 rounded overflow-hidden border border-rose-500/40">
                      <div
                        className="h-full bg-rose-500 transition-all duration-75"
                        style={{
                          width: `${
                            (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {hud.waveBannerText && (
                  <div className="hud-panel px-6 py-2 rounded-lg border-cyan-400/50">
                    <div className="font-display text-xl font-extrabold tracking-widest text-cyan-300 uppercase">
                      {hud.waveBannerText}
                    </div>
                  </div>
                )}

                {hud.tutorialStep < 3 && (
                  <div className="hud-panel px-4 py-2 rounded-lg mt-2 text-center">
                    <div className="text-[11px] font-mono-num text-cyan-300 uppercase tracking-wider">
                      TRAINING STEP {hud.tutorialStep + 1} / 3
                    </div>
                    <div className="text-xs font-medium text-slate-100 mt-0.5">
                      {hud.tutorialStep === 0 &&
                        'Use WASD or the Left Joystick to maneuver around the arena'}
                      {hud.tutorialStep === 1 &&
                        'Aim with Mouse & Hold Left-Click (or Auto-Fire) to destroy hostiles'}
                      {hud.tutorialStep === 2 &&
                        'Press SPACE (or DASH button) to Phase-Dash with brief invulnerability'}
                    </div>
                  </div>
                )}
              </div>

              {/* Top-Right Cluster: Score, Combo, Wave, Utility Icon Buttons */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto">
                  <div className="hud-panel px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-right">
                    <div className="text-[10px] sm:text-[11px] font-bold tracking-wider uppercase text-slate-400 whitespace-nowrap">
                      WAVE {hud.wave} <span className="text-slate-600">·</span>{' '}
                      {formatTime(hud.elapsedSeconds)}
                    </div>
                    <div className="font-mono-num text-xl sm:text-2xl font-extrabold text-slate-50 leading-tight">
                      {hud.score.toLocaleString()}
                    </div>
                    {hud.comboCount > 1 && (
                      <div className="mt-1">
                        <div className="flex items-center justify-end gap-1 text-[10px] sm:text-xs font-mono-num font-bold text-amber-400 whitespace-nowrap">
                          <span>{hud.comboMultiplier.toFixed(2)}x COMBO</span>
                          <span>({hud.comboCount})</span>
                        </div>
                        <div className="w-20 sm:w-24 h-1 bg-slate-950 rounded overflow-hidden ml-auto mt-0.5">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${hud.comboTimerRatio * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Utility Square Icon Buttons: Mute [M] & Pause [P] */}
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={settings.muted ? 'Unmute Audio' : 'Mute Audio'}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        handleUpdateSetting('muted', !settings.muted);
                      }}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg hud-panel hover:border-cyan-400/60 flex items-center justify-center text-slate-200 cursor-pointer"
                    >
                      {settings.muted ? (
                        <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                      )}
                    </button>

                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Pause Game"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engineRef.current?.setMode(
                          hud.mode === 'paused' ? 'playing' : 'paused'
                        );
                      }}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg hud-panel hover:border-cyan-400/60 flex items-center justify-center text-slate-200 cursor-pointer"
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {settings.showFps && (
                  <div className="text-[10px] sm:text-[11px] font-mono-num text-slate-400 px-1">
                    {hud.fps} FPS
                  </div>
                )}
              </div>
            </div>

            {/* Mobile Sub-Row for Boss Bar, Wave Banner & Tutorial */}
            <div className="flex md:hidden flex-col items-center w-full gap-1.5">
              {hud.boss.active && (
                <div className="hud-panel-danger w-full px-3 py-2 rounded-lg">
                  <div className="flex items-center justify-between text-[11px] font-display font-bold tracking-wider text-rose-300 uppercase mb-1">
                    <span>{hud.boss.name}</span>
                    <span className="font-mono-num">
                      {hud.boss.hp} / {hud.boss.maxHp}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-950 rounded overflow-hidden border border-rose-500/40">
                    <div
                      className="h-full bg-rose-500"
                      style={{
                        width: `${
                          (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {hud.waveBannerText && (
                <div className="hud-panel px-4 py-1 rounded-lg border-cyan-400/50">
                  <div className="font-display text-sm font-extrabold tracking-widest text-cyan-300 uppercase">
                    {hud.waveBannerText}
                  </div>
                </div>
              )}

              {hud.tutorialStep < 3 && (
                <div className="hud-panel px-3 py-1.5 rounded-lg text-center w-full">
                  <span className="text-[10px] font-mono-num text-cyan-300 uppercase tracking-wider mr-2">
                    STEP {hud.tutorialStep + 1}/3:
                  </span>
                  <span className="text-[11px] text-slate-200">
                    {hud.tutorialStep === 0 && 'Drag Left Joystick to maneuver'}
                    {hud.tutorialStep === 1 && 'Hold Joystick to auto-aim & fire'}
                    {hud.tutorialStep === 2 && 'Tap DASH button to Phase-Dash'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Offscreen Boss Direction Indicator Arrow */}
          {hud.boss.active && hud.boss.isOffscreen && (
            <div
              className="fixed left-1/2 top-1/2 pointer-events-none z-20"
              style={{
                transform: `translate(-50%, -50%) rotate(${hud.boss.screenAngleRad}rad) translateX(150px)`,
              }}
            >
              <div className="hud-panel-danger px-2.5 py-1 rounded flex items-center gap-1 text-xs font-display font-bold text-rose-400">
                <span>BOSS</span>
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}

          {/* Mobile Touch Controls (Left Virtual Joystick + Right Dash Button) */}
          <div className="flex items-end justify-between w-full md:hidden pointer-events-none mt-auto pt-4">
            <div
              ref={joystickRef}
              onPointerDown={handleJoystickDown}
              onPointerMove={handleJoystickMove}
              onPointerUp={handleJoystickUp}
              onPointerCancel={handleJoystickUp}
              className="relative w-28 h-28 rounded-full border-2 border-cyan-400/40 bg-slate-950/75 pointer-events-auto flex items-center justify-center touch-none"
            >
              <div
                className="w-11 h-11 rounded-full bg-cyan-400/80 shadow-[0_0_14px_rgba(6,182,212,0.7)] pointer-events-none"
                style={{
                  transform: `translate3d(${joystickOffset.x}px, ${joystickOffset.y}px, 0)`,
                }}
              />
            </div>

            <button
              type="button"
              aria-label="Phase Dash"
              onPointerDown={(e) => {
                e.stopPropagation();
                engineRef.current?.triggerDash();
              }}
              className="w-20 h-20 rounded-full hud-panel border-2 border-sky-400/60 active:scale-95 pointer-events-auto flex flex-col items-center justify-center font-display font-bold text-xs tracking-wider text-sky-300 uppercase"
            >
              <span>DASH</span>
              <span className="text-[10px] font-mono-num text-slate-400 mt-0.5">
                {Math.round(hud.dashCooldownRatio * 100)}%
              </span>
            </button>
          </div>
        </section>
      )}

      {/* ═══════════════ LEVEL-UP UPGRADE SELECTION MODAL ═══════════════ */}
      {hud.mode === 'levelup' && (
        <div
          role="dialog"
          aria-label="Level Up Upgrade Selection"
          className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/80"
        >
          <div className="hud-panel max-w-3xl w-full p-6 md:p-8 rounded-2xl">
            <div className="text-center mb-6">
              <div className="text-xs font-mono-num tracking-widest text-cyan-400 uppercase mb-1">
                REACTOR LEVEL {hud.level} REACHED
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-extrabold text-slate-50">
                Select Tactical System Upgrade
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {hud.upgradeChoices.map((u, idx) => {
                const currentRank = hud.upgradeLevels[u.id] ?? 0;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => engineRef.current?.selectUpgrade(u.id)}
                    className="hud-panel hover:border-cyan-400 p-5 rounded-xl text-left flex flex-col justify-between transition-transform hover:-translate-y-1 cursor-pointer group"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs font-mono-num text-slate-400 mb-2">
                        <span>
                          RANK {currentRank + 1} / {u.maxLevel}
                        </span>
                        <span className="text-cyan-300">[{idx + 1}]</span>
                      </div>
                      <h3
                        className="font-display text-lg font-bold mb-1 group-hover:text-cyan-300 transition-colors"
                        style={{ color: u.accentHex }}
                      >
                        {u.name}
                      </h3>
                      <div className="text-xs font-semibold text-slate-200 mb-2.5">
                        {u.role}
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {u.description}
                      </p>
                    </div>

                    <div className="mt-5 pt-3 border-t border-slate-800 text-xs font-display font-bold tracking-wider text-cyan-300 uppercase">
                      Install Module →
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ PAUSE MODAL ═══════════════ */}
      {hud.mode === 'paused' && !showSettingsModal && (
        <div
          role="dialog"
          aria-label="Game Paused"
          className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/80"
        >
          <div className="hud-panel max-w-md w-full p-6 md:p-8 rounded-2xl text-center">
            <h2 className="font-display text-2xl font-extrabold text-slate-50 mb-2">
              Simulation Paused
            </h2>
            <p className="text-xs font-mono-num text-slate-400 mb-6">
              WAVE {hud.wave} · SCORE {hud.score.toLocaleString()} · KILLS {hud.kills}
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => engineRef.current?.setMode('playing')}
                className="w-full py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase cursor-pointer"
              >
                Resume Combat [Esc]
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="w-full py-3 rounded-lg hud-panel hover:border-cyan-400/60 text-slate-100 font-display font-semibold text-sm tracking-wider uppercase cursor-pointer"
              >
                Settings
              </button>
              <button
                type="button"
                onClick={handleStartGame}
                className="w-full py-3 rounded-lg hud-panel hover:border-amber-400/60 text-amber-300 font-display font-semibold text-sm tracking-wider uppercase cursor-pointer"
              >
                Restart Run
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.setMode('title')}
                className="w-full py-3 rounded-lg hud-panel hover:border-rose-400/60 text-slate-300 font-display font-semibold text-sm tracking-wider uppercase cursor-pointer"
              >
                Return to Title
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ GAME OVER MODAL ═══════════════ */}
      {hud.mode === 'gameover' && (
        <div
          role="dialog"
          aria-label="Game Over"
          className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/85"
        >
          <div className="hud-panel-danger max-w-md w-full p-6 md:p-8 rounded-2xl text-center">
            <div className="text-xs font-mono-num tracking-widest text-rose-400 uppercase mb-1">
              MECH CHASSIS CRITICAL FAILURE
            </div>
            <h2 className="font-display text-3xl font-extrabold text-slate-50 mb-2">
              Run Terminated
            </h2>

            {isNewHighScore && (
              <div className="text-xs font-mono-num font-bold text-amber-400 tracking-wider uppercase mb-4">
                NEW PERSONAL RECORD ACHIEVED
              </div>
            )}

            {/* Mastery / Progress Stat Tiles */}
            <div className="grid grid-cols-2 gap-3 my-6 text-left">
              <div className="hud-panel p-3.5 rounded-lg">
                <div className="text-[11px] text-slate-400 uppercase">FINAL SCORE</div>
                <div className="font-mono-num text-xl font-bold text-cyan-300">
                  {hud.score.toLocaleString()}
                </div>
              </div>
              <div className="hud-panel p-3.5 rounded-lg">
                <div className="text-[11px] text-slate-400 uppercase">HIGH SCORE</div>
                <div className="font-mono-num text-xl font-bold text-amber-400">
                  {hud.highScore.toLocaleString()}
                </div>
              </div>
              <div className="hud-panel p-3.5 rounded-lg">
                <div className="text-[11px] text-slate-400 uppercase">WAVE REACHED</div>
                <div className="font-mono-num text-lg font-bold text-slate-100">
                  Wave {hud.wave}
                </div>
              </div>
              <div className="hud-panel p-3.5 rounded-lg">
                <div className="text-[11px] text-slate-400 uppercase">
                  SURVIVAL · KILLS
                </div>
                <div className="font-mono-num text-lg font-bold text-slate-100">
                  {formatTime(hud.elapsedSeconds)} · {hud.kills}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                data-start="true"
                onClick={handleStartGame}
                className="w-full py-3.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-base tracking-wider uppercase cursor-pointer"
              >
                Try Again [Enter]
              </button>
              <button
                type="button"
                onClick={() => engineRef.current?.setMode('title')}
                className="w-full py-3 rounded-lg hud-panel hover:border-cyan-400/60 text-slate-200 font-display font-semibold text-sm tracking-wider uppercase cursor-pointer"
              >
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ SETTINGS MODAL ═══════════════ */}
      {showSettingsModal && (
        <div
          role="dialog"
          aria-label="Settings"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/85"
        >
          <div className="hud-panel max-w-md w-full p-6 md:p-7 rounded-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-xl font-bold text-slate-50">
                System Settings
              </h2>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-xs font-mono-num text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                CLOSE [X]
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Graphics Quality Preset */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
                  Graphics Quality Preset
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['low', 'medium', 'high'] as QualityPreset[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleUpdateSetting('quality', q)}
                      className={`py-2 rounded-lg font-display font-bold text-xs uppercase cursor-pointer border ${
                        settings.quality === q
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                          : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Music Volume */}
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <label htmlFor="music-vol">Synthwave Music Volume</label>
                  <span className="font-mono-num">
                    {Math.round(settings.musicVolume * 100)}%
                  </span>
                </div>
                <input
                  id="music-vol"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.musicVolume}
                  onChange={(e) =>
                    handleUpdateSetting('musicVolume', parseFloat(e.target.value))
                  }
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* SFX Volume */}
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <label htmlFor="sfx-vol">Combat SFX Volume</label>
                  <span className="font-mono-num">
                    {Math.round(settings.sfxVolume * 100)}%
                  </span>
                </div>
                <input
                  id="sfx-vol"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.sfxVolume}
                  onChange={(e) =>
                    handleUpdateSetting('sfxVolume', parseFloat(e.target.value))
                  }
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* Aim Sensitivity */}
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <label htmlFor="aim-sens">Pointer Sensitivity</label>
                  <span className="font-mono-num">
                    {settings.sensitivity.toFixed(1)}x
                  </span>
                </div>
                <input
                  id="aim-sens"
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={settings.sensitivity}
                  onChange={(e) =>
                    handleUpdateSetting('sensitivity', parseFloat(e.target.value))
                  }
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSetting('screenShake', !settings.screenShake)
                  }
                  className="hud-panel px-3 py-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer"
                >
                  <span>Screen Shake</span>
                  <span
                    className={`font-mono-num font-bold ${
                      settings.screenShake ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                  >
                    {settings.screenShake ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleUpdateSetting('showFps', !settings.showFps)}
                  className="hud-panel px-3 py-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer"
                >
                  <span>Show FPS</span>
                  <span
                    className={`font-mono-num font-bold ${
                      settings.showFps ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                  >
                    {settings.showFps ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSetting('pointerLock', !settings.pointerLock)
                  }
                  className="hud-panel px-3 py-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer col-span-2"
                >
                  <span>Desktop Pointer Lock on Click</span>
                  <span
                    className={`font-mono-num font-bold ${
                      settings.pointerLock ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                  >
                    {settings.pointerLock ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  saveGameData({ settings: DEFAULT_SETTINGS });
                  setSettings(DEFAULT_SETTINGS);
                  engineRef.current?.updateSettings(DEFAULT_SETTINGS);
                }}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-xs tracking-wider uppercase cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ HOW TO PLAY MODAL ═══════════════ */}
      {showHowToPlayModal && (
        <div
          role="dialog"
          aria-label="How to Play"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/85"
        >
          <div className="hud-panel max-w-lg w-full p-6 md:p-7 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-slate-50">
                Tactical Briefing · How to Play
              </h2>
              <button
                type="button"
                onClick={() => setShowHowToPlayModal(false)}
                className="text-xs font-mono-num text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                CLOSE [X]
              </button>
            </div>

            <div className="space-y-4 text-xs md:text-sm text-slate-300 leading-relaxed">
              <div>
                <h3 className="font-display font-bold text-cyan-300 uppercase mb-1">
                  1. Controls &amp; Phase Dash
                </h3>
                <p>
                  Move with <strong>WASD / Arrow Keys</strong> (or Left Virtual Joystick
                  on touch devices). Aim with your cursor and hold{' '}
                  <strong>Left-Click</strong> to auto-fire. Press <strong>SPACE</strong>{' '}
                  to Phase-Dash through danger with 0.22s of invulnerability frames.
                </p>
              </div>

              <div>
                <h3 className="font-display font-bold text-amber-300 uppercase mb-1">
                  2. Hostile Machine Archetypes
                </h3>
                <ul className="space-y-1 text-xs">
                  <li>
                    <span className="text-cyan-400 font-semibold">
                      Cyan Interceptor:
                    </span>{' '}
                    Fast swarm unit that closes distance rapidly.
                  </li>
                  <li>
                    <span className="text-fuchsia-400 font-semibold">
                      Magenta Juggernaut:
                    </span>{' '}
                    Heavily armored tank with high contact damage.
                  </li>
                  <li>
                    <span className="text-yellow-400 font-semibold">
                      Yellow Pulse Artillery:
                    </span>{' '}
                    Keeps distance and fires plasma orbs.
                  </li>
                  <li>
                    <span className="text-emerald-400 font-semibold">
                      Green Mitosis Prism:
                    </span>{' '}
                    Splits into 3 fast prism shards when destroyed.
                  </li>
                  <li>
                    <span className="text-rose-400 font-semibold">
                      Red Vanguard Striker:
                    </span>{' '}
                    Projects a red ground telegraph corridor before charging at high
                    speed.
                  </li>
                  <li>
                    <span className="text-rose-500 font-semibold">
                      Omega Core Boss (Every 5 Waves):
                    </span>{' '}
                    Executes radial bullet rings, minion summons, and telegraphed ground
                    slams.
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-display font-bold text-emerald-300 uppercase mb-1">
                  3. Energy Orbs, Combos &amp; 12 Upgrades
                </h3>
                <p>
                  Collect blue XP orbs to level up and choose from 12 stackable upgrades
                  (Multishot, Ricochet, Piercing, Sentinel Orbit Drones, Volatile Kill
                  Explosions, and more). Chain rapid kills within 3 seconds to build up to
                  an <strong>8.0x Score Multiplier</strong>.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={handleStartGame}
                className="px-6 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-display font-bold text-xs tracking-wider uppercase cursor-pointer"
              >
                Launch Mission
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
