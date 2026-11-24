/** A logical creation carries the same UUID through retries and provider replays. */
export class TaskCreationRequests {
  private ids = new Map<string, string>();
  constructor(private uuid: () => string = () => crypto.randomUUID()) {}
  idFor(key: string): string {
    const existing = this.ids.get(key);
    if (existing) return existing;
    const id = this.uuid();
    this.ids.set(key, id);
    return id;
  }
}

/** Provider may issue different tool IDs for the same logical row in one request. */
export const creationRowKey = (row: Record<string, unknown>) => JSON.stringify([
  String(row.name ?? "").trim().toLowerCase(), row.trade, row.manpower,
  String(row.equipment ?? "").trim().toLowerCase(), row.duration, row.startDate ?? null,
]);

export async function runOnce<T>(pending: Map<string, Promise<T>>, id: string, save: () => Promise<T>): Promise<T> {
  const existing = pending.get(id);
  if (existing) return existing;
  const promise = save().catch(error => { pending.delete(id); throw error; });
  pending.set(id, promise);
  return promise;
}