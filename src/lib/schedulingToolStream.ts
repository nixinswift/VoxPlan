interface ToolDelta { index?: number; id?: string; function?: { name?: string; arguments?: string } }
interface ToolCall { id: string; name: string; arguments: string }

/** Track indexed calls and consume each provider identity once per response. */
export class SchedulingToolStream {
  private pending = new Map<number, ToolCall>();
  private executed = new Set<string>();
  append(deltas: ToolDelta[]) {
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const previous = this.pending.get(index);
      const id = delta.id ?? previous?.id ?? `index-${index}`;
      if (this.executed.has(id)) continue;
      this.pending.set(index, {
        id,
        name: delta.function?.name ?? previous?.name ?? "",
        arguments: (previous?.arguments ?? "") + (delta.function?.arguments ?? ""),
      });
    }
  }
  consume(): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const call of this.pending.values()) {
      if (this.executed.has(call.id)) continue;
      this.executed.add(call.id);
      calls.push(call);
    }
    this.pending.clear();
    return calls;
  }
}