require('dotenv').config();
console.log('GOOGLE_OAUTH_TOKENS exists:', !!process.env.GOOGLE_OAUTH_TOKENS);
console.log('OAUTH_CLIENT_JSON exists:', !!process.env.OAUTH_CLIENT_JSON);
if (process.env.GOOGLE_OAUTH_TOKENS) {
  try {
    const tokens = JSON.parse(process.env.GOOGLE_OAUTH_TOKENS);
    console.log('Tokens parsed successfully. access_token:', tokens.access_token ? 'present' : 'missing');
  } catch (e) {
    console.log('JSON parse error:', e.message);
  }
}