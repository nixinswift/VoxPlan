export interface ConcreteDimensions {
  category: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  height: number;
  area: number;
  unit: string;
}

export const CUBIC_METRES_PER_CUBIC_FOOT = 0.028316846592;
export const cubicMetresToYards = (volume: number) => volume / (27 * CUBIC_METRES_PER_CUBIC_FOOT);
export const concreteAreaM2 = (item: Pick<ConcreteDimensions, "area" | "unit">) => item.area * (item.unit === "ft" ? 0.09290304 : 1);

/** All totals use m³; dimensions and explicit area remain in their entered units. */
export function concreteVolumeM3(item: ConcreteDimensions): number {
  const area = item.area > 0 ? item.area : item.length * item.width;
  const depth = item.category === "wall" ? item.height : item.thickness;
  const volume = item.quantity * area * depth;
  return item.unit === "ft" ? volume * CUBIC_METRES_PER_CUBIC_FOOT : volume;
}

export function formatConcreteVolume(volumeM3: number, unit: string): string {
  return unit === "ft" ? `${cubicMetresToYards(volumeM3).toFixed(2)} CY` : `${volumeM3.toFixed(2)} m³`;
}