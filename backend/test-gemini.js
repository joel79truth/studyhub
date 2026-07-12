require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

async function test() {
  try {
    const result = await model.generateContent('Say hello in JSON: {"greeting": "..."}');
    const text = result.response.text();
    console.log('✅ Gemini API key is working. Response:', text);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

test();