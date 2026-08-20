import test from "node:test";
import assert from "node:assert/strict";
import { pickRequestedSpecs, toCsv } from "../src/extract.js";

test("keeps only requested dimension and weight fields", () => {
  assert.deepEqual(pickRequestedSpecs([["Цвет", "серый"], ["Габаритные размеры", "100×20×30 мм"], ["Вес", "250 г"]]), {
    dimensions: "100×20×30 мм", length: "", width: "", height: "", weight: "250 г"
  });
});

test("CSV escapes quotes", () => {
  assert.match(toCsv([{ name: 'A "B"' }]), /"A ""B"""/);
});
