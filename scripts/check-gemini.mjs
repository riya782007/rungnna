// Run with Vercel's server environment; never print or persist credentials.
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.log(JSON.stringify({ configured: false }));
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000),
    });
    console.log(JSON.stringify({ model, status: response.status, available: response.ok }));
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ model, available: false, error: "Model check timed out or could not connect" }));
    process.exitCode = 1;
  }
}
