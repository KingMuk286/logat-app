# LOGAT — Your Personal AI Assistant

## How to Install on Mac (3 Steps)

### STEP 1 — Install Node.js (one time only)
1. Go to: **https://nodejs.org**
2. Click the big green **"LTS"** download button
3. Open the downloaded file and follow the installer
4. Restart your Mac after installing

---

### STEP 2 — Set Up LOGAT
1. Move this **logat-app** folder anywhere you want (Desktop is fine)
2. Open **Terminal** (press Cmd+Space, type "Terminal", hit Enter)
3. Type this and hit Enter:
   ```
   cd ~/Desktop/logat-app
   ```
   *(If you put the folder somewhere else, adjust the path)*
4. Then type this and hit Enter:
   ```
   chmod +x start.sh && ./start.sh
   ```
5. Wait about 1 minute while it installs — LOGAT will launch automatically

---

### STEP 3 — Use LOGAT
- **Type** in the box and hit Enter
- **Tap the orb** or mic button to speak
- Switch modes with the buttons at the bottom:
  - **ALL** — General assistant
  - **LAWN OPS** — Your lawn care business
  - **ROBOTICS** — Technical help
  - **SEARCH** — Live web search
- **VOICE toggle** — Turn spoken responses on/off
- **X button** — Hides to your menu bar (doesn't quit)

---

### To Launch LOGAT in the Future
Just double-click **start.sh** or run `./start.sh` in Terminal.

To make it launch automatically when your Mac starts, open the app and it will ask — just say yes.

---

### Troubleshooting
- **"Permission denied"** → Run: `chmod +x start.sh`
- **App won't open** → Make sure Node.js is installed (Step 1)
- **Voice not working** → Allow microphone access when Mac asks
