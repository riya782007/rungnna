import { all, create } from "mathjs";

const math = create(all, { number: "BigNumber", precision: 32 });
export function calculate(expression: string): string {
  const source = expression.replace(/×/g, "*").replace(/÷/g, "/").trim();
  if (!source || source.length > 120 || !/^[\d.\s()+*/-]+$/.test(source)) throw new Error("Enter a numeric calculation");
  try {
    const result = math.evaluate(source);
    const n = Number(result.toString());
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new Error("Result out of range");
    return math.format(result, { notation: "fixed", precision: 8 }).replace(/\.?0+$/, "") || "0";
  } catch { throw new Error("Check the calculation (division by zero is not allowed)"); }
}
