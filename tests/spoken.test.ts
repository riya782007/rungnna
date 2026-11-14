import { expect, it } from "vitest";
import { spokenNumber, spokenRequest } from "../src/lib/spoken";
it("reads counts said in English, Hindi and Hinglish", () => {
  expect(spokenNumber("count forty five")).toBe(45);
  expect(spokenNumber("Quantity 52")).toBe(52);
  expect(spokenNumber("pachas")).toBe(50);
  expect(spokenNumber("sau piece")).toBe(100);
  expect(spokenNumber("ek sau bees")).toBe(120);
  expect(spokenNumber("dedh sau")).toBe(150);
  expect(spokenNumber("das piece bhej do")).toBe(10);
  expect(spokenNumber("do darjan")).toBe(24);
  expect(spokenNumber("पचास")).toBe(50);
  expect(spokenNumber("२५")).toBe(25);
  expect(spokenNumber("hello")).toBe(null);
});
it("reads a floor request", () => {
  expect(spokenRequest("send 10 boxes of RU1023 to floor 1", ["RU1023"])).toEqual({ qty: 10, code: "RU1023", floor: "1" });
  expect(spokenRequest("RU 1044 das piece floor do bhejo", ["RU1044", "RU10"])).toEqual({ qty: 10, code: "RU1044", floor: "2" });
});
