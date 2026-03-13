# ARB SCANNER — Standalone EXE Build

## How to get your arb-scanner.exe (free, takes 3 minutes)

### Step 1 — Create a free GitHub account
Go to https://github.com and sign up if you don't have one.

### Step 2 — Create a new repository
- Click the + icon top right → New repository
- Name it: arb-scanner
- Set to Private
- Click Create repository

### Step 3 — Upload these files
Click "uploading an existing file" and drag in ALL files from this folder:
  - server.js
  - scanner.html
  - package.json
  - The entire .github folder (including workflows/build.yml)

Click Commit changes.

### Step 4 — Watch it build
- Click the Actions tab in your repository
- You'll see "Build Windows EXE" running automatically
- Wait ~2 minutes for it to finish (green tick)

### Step 5 — Download your EXE
- Click the completed workflow run
- Scroll to the bottom — Artifacts section
- Click arb-scanner-windows to download a zip
- Unzip it — you'll have arb-scanner.exe + scanner.html

### Step 6 — Run it
Put arb-scanner.exe and scanner.html in the same folder.
Double-click arb-scanner.exe.
Your browser will open automatically at http://localhost:3000.

---

## Running the EXE

The exe bundles Node.js inside it — nothing else needs to be installed.

Double-click arb-scanner.exe → server starts → browser opens automatically.

To set your Kalshi API key, create a file called kalshi.env in the same folder:
  KALSHI_API_KEY=your_key_here

Or set it as a Windows environment variable before running.

---

## Rebuild after changes

Any time you push changes to GitHub, Actions will automatically rebuild the exe.
Just re-download from the Actions artifacts tab.

---

## Files

  server.js                     Backend server + arb engine
  scanner.html                  Dashboard UI (must stay alongside exe)
  package.json                  Dependencies + pkg build config
  .github/workflows/build.yml   GitHub Actions build pipeline
