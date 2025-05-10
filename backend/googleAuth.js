import { google } from 'googleapis';
// import { authenticate } from '@google-cloud/local-auth'; // No longer needed for web server session flow
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'];
// const TOKEN_PATH = path.join(__dirname, 'token.json'); // No longer used for multi-user session flow
// const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json'); // No longer using file-based credentials

/*
// Functions related to token.json (loadSavedCredentialsIfExist, saveCredentials, authorize) 
// are removed as they are for single-user/local-auth flow. 
// Session-based token management is handled in server.js.
*/

/**
 * Initializes an OAuth2 client with application credentials from environment variables.
 * This client is used to generate the auth URL and for the initial token exchange.
 * @return {Promise<google.auth.OAuth2>}
 */
export async function getOAuthClient() {
  try {
    const client_id = process.env.GOOGLE_CLIENT_ID;
    const client_secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    if (!client_id || !client_secret || !redirectUri) {
      throw new Error('Google OAuth credentials not found in environment variables.');
    }

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
    return oAuth2Client;
  } catch (err) {
    console.error('Error initializing OAuth client:', err);
    throw new Error('Could not initialize OAuth client. Ensure environment variables are set correctly. Error: ' + err.message);
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