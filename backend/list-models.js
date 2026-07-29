// list-models.js
require("dotenv").config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing in .env");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

(async () => {
  try {
    console.log("🔍 Fetching available models...\n");
    const response = await fetch(url);
    const data = await response.json();

    if (data.models) {
      const supported = data.models.filter(m =>
        m.supportedGenerationMethods?.includes("generateContent")
      );

      console.log("✅ Models that support generateContent:\n");
      supported.forEach(m => {
        console.log(`- ${m.name}  (${m.displayName || ''})`);
      });
      if (supported.length === 0) {
        console.log("(none found – check API key permissions)");
      }
    } else {
      console.log("Unexpected response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("Fetch error:", err.message);
  }
})();