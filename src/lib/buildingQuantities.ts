export interface MeasuredBuildingQuantity { quantity: number; length: number; width: number; uom: string }

/** Civil volume/mass retain an integer occurrence count and a fractional per-occurrence scalar. */
export function calcBuildingQty(item: MeasuredBuildingQuantity): number {
  if (item.uom === "m2") {
    const area = item.length * item.width;
    return item.quantity * (area > 0 ? area : 1);
  }
  if (["m", "m3", "t"].includes(item.uom)) {
    return item.quantity * (item.length > 0 ? item.length : 1);
  }
  return item.quantity;
}