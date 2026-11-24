export type CivilVolumeBasis = "BCM" | "LCM" | "CCM";

const cubicMetres = "(?:m(?:3|³)|cubic\\s+met(?:re|er)s?)";
const terms = [
  ["BCM", "bank"], ["LCM", "loose"], ["CCM", "compacted"],
] as const;
const patterns = terms.map(([basis, term]) => ({
  basis,
  pattern: new RegExp(`\\b${basis}\\b|\\b${term}\\s+${cubicMetres}(?![a-z0-9])|${cubicMetres}\\s*\\(?${term}\\b`, "i"),
}));

/** Legacy civil rows store the volume basis in the description. Ambiguous rows need review. */
export function civilVolumeBasis(description: string): CivilVolumeBasis | null {
  const matches = patterns.filter(({ pattern }) => pattern.test(description));
  return matches.length === 1 ? matches[0].basis : null;
}

export function civilTakeoffUnit(trade: string | null, uom: string, description: string) {
  if (trade !== "civil" || !/^m[3³]$/i.test(uom)) return uom;
  return civilVolumeBasis(description) ?? "m³ — basis unverified";
}
