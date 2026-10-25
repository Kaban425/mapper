// Travel time along the route at a constant speed: sprinting on foot and the Dacia
// without boost (its default speed is not verified in game yet, U-3).

export const kmhToMps = (kmh: number): number => kmh / 3.6;

export function travelSeconds(meters: number, metersPerSecond: number): number {
  if (!(metersPerSecond > 0) || !Number.isFinite(meters) || meters <= 0) return 0;
  return meters / metersPerSecond;
}
