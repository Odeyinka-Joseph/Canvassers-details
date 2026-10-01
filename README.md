# Canvasser Data Capture

Static web app (single `index.html`) for capturing canvasser VIN and bank details, with user/admin logins,
Name/Phone/LGA autofill from an admin-uploaded CSV, and Excel export.

## Hosting on GitHub Pages
1. Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
2. Open `https://<your-username>.github.io/<repo-name>/`.

GitHub Pages runs in **local mode**: logins, the canvasser list and responses are stored in each user's own
browser. Admin must create the admin account and upload the CSV on each device, then export Excel from each device
and combine them with "Merge responses from an Excel export".

## Optional shared backend
`backend/server.js` (Node 16+, no dependencies) provides shared logins and data. It cannot run on GitHub Pages.
Host it elsewhere over HTTPS and point the page at it via "Server settings" on the login screen.

## Privacy
Never commit `data.json`, canvasser CSVs or Excel exports to this repository. Public repos are public.
