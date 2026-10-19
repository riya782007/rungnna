/** Printer heat and feed speed affect darkness without changing sticker data or geometry. */
export type LabelHeat = { density?: number; speed?: number };
export const DEFAULT_LABEL_DENSITY = 10;
export const DEFAULT_LABEL_SPEED = 2;
export function labelHeat(value: LabelHeat = {}) {
  const density = value.density ?? DEFAULT_LABEL_DENSITY;
  const speed = value.speed ?? DEFAULT_LABEL_SPEED;
  if (!Number.isInteger(density) || density < 0 || density > 15 || !Number.isInteger(speed) || speed < 1 || speed > 6)
    throw new Error("Label darkness must be 0–15 and speed 1–6");
  return { density, speed };
}
