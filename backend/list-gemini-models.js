require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

(async () => {
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.models) {
      console.log('Available models for your API key:');
      data.models.forEach(m => {
        const methods = m.supportedGenerationMethods?.join(', ') || 'none';
        console.log(`  - ${m.name} (methods: ${methods})`);
      });
    } else {
      console.log('No models found or unexpected response:', data);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
})();