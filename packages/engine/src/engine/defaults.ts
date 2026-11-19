// Starting values for NationState fields that content does not provide.
// Placeholders until the compendium gives per-nation numbers.
export const START = {
  readiness: 50,
  mobilization: 0,
  /** 5 = peacetime. */
  alert: 5,
  /** No read on a rival's bluffing yet: 50%. */
  perceivedBlfBp: 5000,
  declaredConfidenceBp: 6000,
  undeclaredConfidenceBp: 3000,
} as const;
