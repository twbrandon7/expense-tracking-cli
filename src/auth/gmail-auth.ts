import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import { google } from 'googleapis';
import type { Auth } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');

export type OAuth2Client = Auth.OAuth2Client;


export function getRedirectUri(): string {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials.json in project root (${CREDENTIALS_PATH}). Please download your Google Cloud OAuth 2.0 Client ID (Desktop app) credentials.`
    );
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { redirect_uris } = credentials.installed || credentials.web || {};
  return redirect_uris?.[0] || 'http://localhost:3000/oauth2callback';
}

export function getOAuth2Client(): OAuth2Client {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials.json in project root (${CREDENTIALS_PATH}). Please download your Google Cloud OAuth 2.0 Client ID (Desktop app) credentials.`
    );
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id } = credentials.installed || credentials.web || {};
  const redirectUri = getRedirectUri();
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const oAuth2Client = getOAuth2Client();

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  throw new Error('Not authenticated. Please run "npx ts-node src/cli.ts auth" first to complete authentication.');
}

export async function authenticateInteractive(): Promise<void> {
  const oAuth2Client = getOAuth2Client();
  const redirectUri = getRedirectUri();
  const parsedRedirect = new URL(redirectUri);
  const port = parsedRedirect.port ? parseInt(parsedRedirect.port, 10) : 3000;
  const pathname = parsedRedirect.pathname || '/oauth2callback';

  if (fs.existsSync(TOKEN_PATH)) {
    console.log('Existing token.json found. Re-authenticating to update tokens...');
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n==================================================');
  console.log('Authorize this app by visiting the following URL:');
  console.log(authUrl);
  console.log('==================================================\n');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url && req.url.startsWith(pathname)) {
          const urlObj = new URL(req.url, `http://localhost:${port}`);
          const code = urlObj.searchParams.get('code');

          if (code) {
            res.end('Authentication successful! You can close this browser tab.');
            server.close();

            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

            console.log('Token successfully saved to token.json');
            resolve();
          } else {
            res.end('Authentication failed: Missing code parameter.');
            reject(new Error('Missing authorization code in callback URL.'));
          }
        }
      } catch (err) {
        res.end('Authentication error occurred.');
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`Listening on http://localhost:${port}${pathname} for Google OAuth callback...`);
    });
  });
}

