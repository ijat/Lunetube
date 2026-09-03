/**
 * Motion presets. Durations are Lunegit's (plan F4): 120 / 180 / 250 / 350 / 500.
 * Every preset ships a `prefers-reduced-motion` variant that collapses to an
 * opacity-only fade (PRD §7).
 */
import type { Transition, Variants } from 'motion/react';

export const DURATIONS = {
  instant: 0.12,
  fast: 0.18,
  base: 0.25,
  moderate: 0.35,
  slow: 0.5,
} as const;

/** The mockup easing curve `cubic-bezier(.22,.61,.36,1)`. */
export const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export const PRESS_SCALE = 0.98;

export const springs = {
  soft: { type: 'spring', stiffness: 260, damping: 30 } satisfies Transition,
  snappy: { type: 'spring', stiffness: 420, damping: 34 } satisfies Transition,
  gentle: { type: 'spring', stiffness: 170, damping: 26 } satisfies Transition,
} as const;

export interface MotionPreset {
  full: Variants;
  reduced: Variants;
}

const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATIONS.fast } },
  exit: { opacity: 0, transition: { duration: DURATIONS.instant } },
};

export const fade: MotionPreset = {
  full: fadeOnly,
  reduced: fadeOnly,
};

export const slideUp: MotionPreset = {
  full: {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: DURATIONS.base, ease: EASE },
    },
    exit: { opacity: 0, y: 6, transition: { duration: DURATIONS.fast, ease: EASE } },
  },
  reduced: fadeOnly,
};

export const scaleIn: MotionPreset = {
  full: {
    hidden: { opacity: 0, scale: 0.96 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: DURATIONS.fast, ease: EASE },
    },
    exit: { opacity: 0, scale: 0.98, transition: { duration: DURATIONS.instant } },
  },
  reduced: fadeOnly,
};

export const listStagger = {
  visible: { transition: { staggerChildren: 0.04 } },
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Picks the right variant set for the current OS setting. */
export function resolvePreset(preset: MotionPreset, reduced = prefersReducedMotion()): Variants {
  return reduced ? preset.reduced : preset.full;
}
