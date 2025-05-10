import { google } from 'googleapis';
// import { authenticate } from '@google-cloud/local-auth'; // No longer needed for web server session flow
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'];
// const TOKEN_PATH = path.join(__dirname, 'token.json'); // No longer used for multi-user session flow
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json'); 

/*
// Functions related to token.json (loadSavedCredentialsIfExist, saveCredentials, authorize) 
// are removed as they are for single-user/local-auth flow. 
// Session-based token management is handled in server.js.
*/

/**
 * Initializes an OAuth2 client with application credentials.
 * This client is used to generate the auth URL and for the initial token exchange.
 * @return {Promise<google.auth.OAuth2>}
 */
export async function getOAuthClient() {
  try {
    const credentialsContent = await fs.readFile(CREDENTIALS_PATH);
    const config = JSON.parse(credentialsContent);
    // Ensure we are using web credentials if available, otherwise try installed
    const creds = config.web || config.installed;
    if (!creds) {
        throw new Error('Web or installed credentials not found in credentials.json');
    }
    const { client_secret, client_id, redirect_uris } = creds;
    // Use the redirect_uri from environment variable if available, otherwise the first one from credentials.json
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || (redirect_uris && redirect_uris.length > 0 ? redirect_uris[0] : undefined);
    if (!redirectUri) {
        throw new Error('Redirect URI not found in credentials.json or GOOGLE_REDIRECT_URI env var.');
    }

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
    return oAuth2Client;
  } catch (err) {
      console.error('Error reading credentials.json for OAuth client:', err);
      throw new Error('Could not initialize OAuth client. Ensure credentials.json exists and is valid. Error: ' + err.message);
  }
}

/**
 * Generates the Google authentication URL.
 * @param {google.auth.OAuth2} oAuth2Client An initialized OAuth2 client.
 * @return {string} The authentication URL.
 */
export function getAuthUrl(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', 
    prompt: 'consent', 
    scope: SCOPES.concat(['https://www.googleapis.com/auth/userinfo.email']), // Ensure email scope is included
  });
  return authUrl;
}

/*
// getTokensFromCode is no longer strictly needed here as the logic is now in server.js's callback.
// If you want to keep it as a utility, it should not save tokens to token.json.
export async function getTokensFromCode(oAuth2Client, code) {
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  // DO NOT save to token.json here.
  // console.log('Tokens obtained (but not saved globally from googleAuth.js).');
  return oAuth2Client; // Or just return tokens
}
*/

/*
// getGmailClient is also removed as server.js now has a session-aware version.
export async function getGmailClient() {
    // ... old implementation using authorize() ...
}
*/

export { google }; 