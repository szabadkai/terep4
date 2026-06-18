import { RACE } from '../config';

export type RaceLengthId = 'short' | 'standard' | 'long';
export type TerrainDifficultyId = 'mild' | 'standard' | 'wild';

export interface CoursePresetSelection {
  length: RaceLengthId;
  difficulty: TerrainDifficultyId;
}

export interface CoursePreset extends CoursePresetSelection {
  label: string;
  checkpointCount: number;
  ringRadius: number;
  ringJitter: number;
  captureRadius: number;
  minLandHeight: number;
  terrainSafety: number;
}

export const DEFAULT_COURSE_SELECTION: CoursePresetSelection = {
  length: 'standard',
  difficulty: 'standard',
};

const LENGTHS: Record<RaceLengthId, { label: string; checkpoints: number; radius: number }> = {
  short: { label: 'Short', checkpoints: 5, radius: 0.82 },
  standard: { label: 'Standard', checkpoints: RACE.checkpointCount, radius: 1 },
  long: { label: 'Long', checkpoints: 10, radius: 1 },
};

const DIFFICULTIES: Record<
  TerrainDifficultyId,
  {
    label: string;
    radius: number;
    jitter: number;
    capture: number;
    minLandHeight: number;
    terrainSafety: number;
  }
> = {
  mild: {
    label: 'Mild',
    radius: 1,
    jitter: 1,
    capture: 4,
    minLandHeight: RACE.minLandHeight,
    terrainSafety: 1.75,
  },
  standard: {
    label: 'Standard',
    radius: 1,
    jitter: 1,
    capture: 0,
    minLandHeight: RACE.minLandHeight,
    terrainSafety: 1.75,
  },
  wild: {
    label: 'Wild',
    radius: 1,
    jitter: 1,
    capture: -1,
    minLandHeight: RACE.minLandHeight,
    terrainSafety: 1.75,
  },
};

export function coursePreset(selection: CoursePresetSelection): CoursePreset {
  const length = LENGTHS[selection.length];
  const difficulty = DIFFICULTIES[selection.difficulty];
  return {
    ...selection,
    label: `${length.label} / ${difficulty.label}`,
    checkpointCount: length.checkpoints,
    ringRadius: RACE.ringRadius * length.radius * difficulty.radius,
    ringJitter: RACE.ringJitter * difficulty.jitter,
    captureRadius: Math.max(9, RACE.captureRadius + difficulty.capture),
    minLandHeight: difficulty.minLandHeight,
    terrainSafety: difficulty.terrainSafety,
  };
}

export function sameCourseSelection(a: CoursePresetSelection, b: CoursePresetSelection): boolean {
  return a.length === b.length && a.difficulty === b.difficulty;
}
