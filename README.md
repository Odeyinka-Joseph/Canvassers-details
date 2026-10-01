# Canvasser Data Capture

Static web app (`index.html`) for capturing canvasser VIN and bank details, with User and Admin logins,
Name/Phone/LGA autofill from an admin-uploaded CSV, and Excel export.

## Shared logins on every device (Google Sheets backend)
1. Create a new Google Sheet. Extensions > Apps Script. Paste `backend/Code.gs`, save.
2. Deploy > New deployment > Web app. Execute as: **Me**. Who has access: **Anyone**. Copy the Web app URL (ends in `/exec`).
3. Put the URL in `config.json` in this repo: `{ "server": "https://script.google.com/macros/s/XXXX/exec" }`
4. Open the site. The first visit requires creating the admin profile. After that, every device uses the same logins and data.

All data (users, directory, responses) lives in the Google Sheet you own. Passwords are stored as salted hashes.
With `config.json` empty the app runs in local mode (data stays in each browser).

## Alternative backend
`backend/server.js` (Node 16+) provides the same API for self-hosting over HTTPS.

## Privacy
Never commit CSVs, Excel exports or `data.json` to this repository. Public repos are public.
