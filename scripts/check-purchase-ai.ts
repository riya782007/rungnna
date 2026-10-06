import { readFileSync } from "node:fs";
import { gemini } from "../api/_lib";
// Only a generated fixture is transmitted. Never log keys or model response text.
try {
  const image = readFileSync("dist/print-trials/demo-purchase.png").toString("base64");
  const out = await gemini([{ inline_data: { mime_type: "image/png", data: image } }, { text: 'Read this synthetic purchase bill. Return JSON {"supplier":"","bill_no":"","invoice_total":"","rows":[{"item":"","style":"","unit":"","qty":"","cost":"unit cost in rupees","rate":"selling rate only if printed"}]}. Extract visible facts only, never guess selling rate. Quantities and money are decimal strings.' }], { json: true, temperature: 0 });
  const line = out.rows?.[0];
  const correct = out.bill_no === "DEMO-123" && Number(out.invoice_total) === 120.36 && line?.item === "BALI" && line.unit === "PAIR" && Number(line.qty) === 4 && Number(line.cost) === 25.5 && !line.rate;
  console.log(JSON.stringify({ synthetic_image_read: true, calculations_extracted_correctly: correct }));
  if (!correct) process.exitCode = 1;
} catch (e: any) {
  console.log(JSON.stringify({ synthetic_image_read: false, status: e.status || null, reason: e.name === "TimeoutError" ? "timeout" : "provider or connection failed" }));
  process.exitCode = 1;
}
