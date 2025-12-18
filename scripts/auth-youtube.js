const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

// CONFIG
const CREDENTIALS_PATH = path.join(__dirname, '../client_secret.json');
const TOKEN_PATH = path.join(__dirname, '../tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

async function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline', // CRITICAL for Refresh Token
        scope: SCOPES,
    });

    console.log('\nAuthorize this app by visiting this url:\n');
    console.log(authUrl);
    console.log('\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Enter the code from that page here: ', async (code) => {
        rl.close();

        try {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);

            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
            console.log(`\nSuccess! Token stored to ${TOKEN_PATH}`);
            console.log('You can now run the app with Auto-Publish enabled.');
        } catch (err) {
            console.error('Error retrieving access token', err);
        }
    });
}

async function main() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('Error: client_secret.json not found in project root.');
        console.error('Please download it from Google Cloud Console -> Credentials -> OAuth Client ID (Desktop).');
        process.exit(1);
    }

    const content = fs.readFileSync(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    // Support both installed and web formats
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris ? redirect_uris[0] : 'http://localhost'
    );

    await getAccessToken(oAuth2Client);
}

main();
