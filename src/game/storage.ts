import { QualityPreset } from './config';

export interface GameSettings {
  musicVolume: number; // 0 to 1
  sfxVolume: number; // 0 to 1
  muted: boolean;
  quality: QualityPreset;
  screenShake: boolean;
  sensitivity: number; // 0.5 to 2.0
  pointerLock: boolean;
  showFps: boolean;
}

export interface SavedData {
  highScore: number;
  bestWave: number;
  tutorialDone: boolean;
  settings: GameSettings;
}

const STORAGE_KEY = 'neon_survivor_3d_save_v1';

export const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.45,
  sfxVolume: 0.75,
  muted: false,
  quality: 'high',
  screenShake: true,
  sensitivity: 1.0,
  pointerLock: false,
  showFps: true,
};

export function loadSavedData(): SavedData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        highScore: 0,
        bestWave: 1,
        tutorialDone: false,
        settings: { ...DEFAULT_SETTINGS },
      };
    }
    const parsed = JSON.parse(raw);
    return {
      highScore: typeof parsed.highScore === 'number' ? parsed.highScore : 0,
      bestWave: typeof parsed.bestWave === 'number' ? parsed.bestWave : 1,
      tutorialDone: Boolean(parsed.tutorialDone),
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings || {}),
      },
    };
  } catch {
    return {
      highScore: 0,
      bestWave: 1,
      tutorialDone: false,
      settings: { ...DEFAULT_SETTINGS },
    };
  }
}

export function saveGameData(data: Partial<SavedData>): SavedData {
  const current = loadSavedData();
  const next: SavedData = {
    highScore: Math.max(current.highScore, data.highScore ?? current.highScore),
    bestWave: Math.max(current.bestWave, data.bestWave ?? current.bestWave),
    tutorialDone: data.tutorialDone ?? current.tutorialDone,
    settings: data.settings ? { ...current.settings, ...data.settings } : current.settings,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota or private mode errors
  }
  return next;
}
