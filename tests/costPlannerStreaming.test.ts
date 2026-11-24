import { expect, test } from "bun:test";
import { finalOnlyOutput } from "../supabase/functions/plan-drawing-costs/final-only-output";

test("cost proposals skip per-token JSON reparsing while keeping strict schema and final validation", async () => {
  let partialParses = 0;
  let completeParses = 0;
  const schema = Promise.resolve({ type: "json", schema: { type: "object", additionalProperties: false } });
  const output = finalOnlyOutput({
    responseFormat: schema,
    parsePartialOutput: async ({ text }: { text: string }) => { partialParses++; return { partial: JSON.parse(text) }; },
    parseCompleteOutput: async ({ text }: { text: string }) => { completeParses++; const value = JSON.parse(text); if (!Array.isArray(value.labour)) throw Error("Invalid labour"); return value; },
  });
  for (let i = 0; i < 5000; i++) expect(await output.parsePartialOutput({ text: '{"labour":[' })).toBeUndefined();
  expect(partialParses).toBe(0);
  expect(output.responseFormat).toBe(schema);
  expect(await output.parseCompleteOutput({ text: '{"labour":[{"estimateId":"M-101"}]}' })).toEqual({ labour: [{ estimateId: "M-101" }] });
  expect(completeParses).toBe(1);
  expect(output.parseCompleteOutput({ text: '{"labour":null}' })).rejects.toThrow("Invalid labour");
});