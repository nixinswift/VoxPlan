export interface DrawingAudit {
  sheetsRead?: string[];
  uncertainties?: string[];
  exclusions?: string[];
}

export interface DrawingLine {
  [key: string]: any;
  description: string;
  note?: string;
}

export function readDrawingTakeoff(message: any) {
  const concrete: DrawingLine[] = [];
  const building: DrawingLine[] = [];
  const audits: DrawingAudit[] = [];
  const errors: string[] = [];
  for (const call of message?.tool_calls ?? []) {
    const name = call.function?.name;
    if (name !== "add_items" && name !== "add_building_items") continue;
    let args;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      errors.push(`Couldn't read ${name} quantities. Retry this drawing before saving its full scope.`);
      continue;
    }
    if (args.drawingAudit) audits.push(args.drawingAudit);
    if (!Array.isArray(args.items)) continue;
    (name === "add_items" ? concrete : building).push(...args.items);
  }
  if (errors.length) audits.push({ uncertainties: errors });
  return { concrete, building, audits, count: concrete.length + building.length };
}