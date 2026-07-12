require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const oauthClientJson = JSON.parse(process.env.OAUTH_CLIENT_JSON);
const { client_id, client_secret, redirect_uris } = oauthClientJson.web;
const redirectUri = redirect_uris[0]; // should be 'http://localhost'

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

// Generate the URL to ask for permissions
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
  prompt: 'consent',
});

console.log('🌐 Open this URL in your browser and allow access:\n');
console.log(authUrl);
console.log('\nWaiting for authorization code...');

// Create a tiny HTTP server to catch the callback
const server = http.createServer(async (req, res) => {
  const queryObject = url.parse(req.url, true).query;
  if (queryObject.code) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorization successful! You can close this window.\n');
    server.close();

    try {
      // Exchange the code for tokens
      const { tokens } = await oauth2Client.getToken(queryObject.code);
      console.log('\n✅ New tokens received. Update your .env file with:\n');
      console.log('GOOGLE_OAUTH_TOKENS=' + JSON.stringify(tokens));
      console.log('\nCopy the entire line above and paste it into your .env file, replacing the old GOOGLE_OAUTH_TOKENS.');
    } catch (err) {
      console.error('Error getting tokens:', err.message);
    }
    process.exit(0);
  } else {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('No code found in the callback.');
  }
});

server.listen(80, () => console.log('Callback server listening on http://localhost')); // redirect_uri should match port 80