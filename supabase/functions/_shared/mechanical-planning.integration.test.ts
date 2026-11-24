import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const url = process.env.VOXPLAN_TEST_URL;
const token = process.env.VOXPLAN_TEST_TOKEN;
const key = process.env.VOXPLAN_TEST_KEY;
const liveTest = url && token && key ? test : test.skip;

async function invoke(name: string, body: unknown) {
  if (!url || !token || !key) throw new Error("Authenticated integration test configuration required");
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response;
}

for (const endpoint of ["estimating-chat", "building-takeoff-chat"]) {
  liveTest(`${endpoint} measures industrial pipe and counts valves without concrete substitutions`, async () => {
    const response = await invoke(endpoint, { messages: [{ role: "user", content:
      "Take off ONLY this confirmed industrial mechanical BOM: one 120 metre run of DN100 carbon steel process piping, 12 DN100 elbows, 4 DN100 isolation valves, and 2 tagged pumps. Package M-101. Supply only. No extra scope or allowances; call add_building_items now with these four lines."
    }] });
    const data = await response.json();
    const calls = data.choices?.[0]?.message?.tool_calls ?? [];
    expect(calls.some((call: any) => call.function.name === "add_items")).toBe(false);
    const items = calls.filter((call: any) => call.function.name === "add_building_items")
      .flatMap((call: any) => JSON.parse(call.function.arguments).items);
    expect(items).toHaveLength(4);
    expect(items.every((item: any) => item.trade === "mechanical")).toBe(true);
    const pipe = items.find((item: any) => item.uom === "m");
    expect(pipe?.quantity * pipe?.length).toBe(120);
    const counts = items.filter((item: any) => item.uom === "ea").map((item: any) => item.quantity).sort((a: number, b: number) => a - b);
    expect(counts).toEqual([2, 4, 12]);
  }, 120000);
}

liveTest("scheduling keeps an industrial pipefitting crew and duration", async () => {
  const response = await invoke("ai-scheduling-buddy", { messages: [{ role: "user", content:
    "Add one task: M-101 process piping spool erection, 6 pipefitters, 5 working days, 1 crane. All prerequisites and permits are approved. Create it now."
  }], scheduleContext: [], today: "2026-10-26" });
  const stream = await response.text();
  const calls = new Map<number, { name: string; arguments: string }>();
  for (const line of stream.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    const data = JSON.parse(line.slice(6));
    for (const delta of data.choices?.[0]?.delta?.tool_calls ?? []) {
      const current = calls.get(delta.index) ?? { name: "", arguments: "" };
      current.name += delta.function?.name ?? "";
      current.arguments += delta.function?.arguments ?? "";
      calls.set(delta.index, current);
    }
  }
  const call = [...calls.values()].find((item) => item.name === "create_task");
  expect(call).toBeDefined();
  const task = JSON.parse(call?.arguments ?? "{}");
  expect(task.trade).toBe("mechanical");
  expect(task.manpower).toBe(6);
  expect(task.duration).toBe(5);
}, 120000);

liveTest("technical PDF BOM is measured once across duplicate sheets with source evidence", async () => {
  const fixture = process.env.VOXPLAN_DRAWING_FIXTURE;
  if (!fixture) throw new Error("VOXPLAN_DRAWING_FIXTURE is required");
  const file = readFileSync(fixture).toString("base64");
  const response = await invoke("building-takeoff-chat", {
    messages: [{ role: "user", content: "Take off new material supply ONLY from the BOM. Reconcile duplicate pages; do not add installation or allowances. Provide source evidence and drawingAudit." }],
    files: [{ name: "M101-isometric.pdf", mimeType: "application/pdf", dataUrl: `data:application/pdf;base64,${file}` }],
  });
  const data = await response.json();
  const args = data.choices[0].message.tool_calls.filter((c: any) => c.function.name === "add_building_items").map((c: any) => JSON.parse(c.function.arguments));
  const items = args.flatMap((a: any) => a.items);
  expect(items.every((item: any) => item.trade === "mechanical")).toBe(true);
  expect(items.filter((item: any) => item.uom === "m").reduce((sum: number, item: any) => sum + item.quantity * item.length, 0)).toBe(12.5);
  expect(items.filter((item: any) => item.uom === "ea").map((item: any) => item.quantity).sort((a: number,b: number) => a-b)).toEqual([1, 2]);
  expect(items.every((item: any) => typeof item.note === "string" && item.note.includes("M-101"))).toBe(true);
  expect(args.some((a: any) => a.drawingAudit?.sheetsRead?.length > 0)).toBe(true);
}, 120000);

liveTest("technical PDF generates installation and test package activities, not residential scope", async () => {
  const fixture = process.env.VOXPLAN_DRAWING_FIXTURE;
  if (!fixture) throw new Error("VOXPLAN_DRAWING_FIXTURE is required");
  const response = await invoke("review-schedule-upload", {
    mode: "plan", fileName: "M101-isometric.pdf", fileType: "application/pdf", fileBase64: readFileSync(fixture).toString("base64"),
    planningContext: "Start Monday 2026-11-02. One 4-person pipefitter/welder crew, 8 hours per day, Monday-Friday. Materials and supports released. No operating-system tie-in. Scope includes fabrication, erection, NDE per approved ITP, pressure testing before insulation, flushing, reinstatement and turnover. Test pressure is not specified: flag this, do not invent it.",
  });
  const data = await response.json();
  expect(data.activities.length).toBeGreaterThan(3);
  expect(data.activities.some((a: any) => /test/i.test(a.name))).toBe(true);
  expect(data.activities.some((a: any) => /insulat/i.test(a.name))).toBe(true);
  expect(data.activities.some((a: any) => /siding|drywall|tyvek/i.test(a.name))).toBe(false);
  expect(data.activities.every((a: any) => typeof a.notes === "string" && a.notes.length > 0)).toBe(true);
  expect(data.drawingAudit.sheetsRead.length).toBeGreaterThan(0);
  const test = data.activities.find((a: any) => /pressure|hydro/i.test(a.name));
  const insulation = data.activities.find((a: any) => /insulat/i.test(a.name));
  expect(test).toBeDefined(); expect(insulation).toBeDefined();
  expect(test.startDate < insulation.startDate).toBe(true);
}, 120000);