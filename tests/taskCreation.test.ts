import { expect, test } from "bun:test";
import { TaskCreationRequests, runOnce, creationRowKey } from "../src/lib/taskCreation";

test("D01 same creation identity survives replay, separate requests stay distinct", () => {
  let counter = 0;
  const ids = new TaskCreationRequests(() => String(++counter));
  expect(ids.idFor("request-1/tool-a/0")).toBe("1");
  expect(ids.idFor("request-1/tool-a/0")).toBe("1");
  expect(ids.idFor("request-2/tool-a/0")).toBe("2");
});
test("D01 concurrent duplicate callbacks save once and failures can retry", async () => {
  const pending = new Map<string, Promise<number>>();
  let writes = 0;
  const save = async () => ++writes;
  expect(await Promise.all([runOnce(pending, "lift", save), runOnce(pending, "lift", save)])).toEqual([1, 1]);
  expect(writes).toBe(1);
  await expect(runOnce(pending, "retry", async () => { throw Error("offline"); })).rejects.toThrow("offline");
  expect(await runOnce(pending, "retry", save)).toBe(2);
});
test("D01 different provider IDs with identical payload share a logical row key", () => {
  const row = { name: "QA Crane Lift A", trade: "mechanical", manpower: 3, equipment: "Crane C1", duration: 2, startDate: "2026-11-23" };
  expect(creationRowKey({ ...row, callId: "a" })).toBe(creationRowKey({ ...row, callId: "b" }));
  expect(creationRowKey(row)).not.toBe(creationRowKey({ ...row, startDate: "2026-11-25" }));
});