// test-openai.js
require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

(async () => {
  try {
    const response = await openai.models.list();
    console.log('✅ OpenAI key is valid. Models accessible:', response.data.length);
  } catch (err) {
    console.error('❌ OpenAI key error:', err.message);
  }
})();