/**
 * Keep the SDK's strict wire schema and final parser, but skip reparsing the
 * growing JSON document on every token. This endpoint never displays partial
 * objects; parsing them makes long proposals quadratic in CPU work.
 */
export function finalOnlyOutput<T extends { parsePartialOutput: (...args: any[]) => Promise<any> }>(output: T): T {
  return { ...output, parsePartialOutput: async () => undefined };
}