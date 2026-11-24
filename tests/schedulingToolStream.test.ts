import { test, expect } from "bun:test";
import { SchedulingToolStream } from "../src/lib/schedulingToolStream";

test("D01 repeated finish chunks and replayed tool IDs execute exactly once", () => {
  const stream = new SchedulingToolStream();
  const delta = { index: 0, id: "lift-1", function: { name: "create_task", arguments: '{"name":"QA Crane Lift A"}' } };
  stream.append([delta]);
  expect(stream.consume()).toHaveLength(1);
  expect(stream.consume()).toHaveLength(0);
  stream.append([delta]);
  expect(stream.consume()).toHaveLength(0);
});

test("D01 multiple indexed calls retain fragmented arguments separately", () => {
  const stream = new SchedulingToolStream();
  stream.append([{ index: 0, id: "a", function: { name: "create_task", arguments: '{"name":' } }, { index: 1, id: "b", function: { name: "create_task", arguments: '{"name":' } }]);
  stream.append([{ index: 1, function: { arguments: '"B"}' } }, { index: 0, function: { arguments: '"A"}' } }]);
  expect(stream.consume().map(call => JSON.parse(call.arguments).name)).toEqual(["A", "B"]);
});