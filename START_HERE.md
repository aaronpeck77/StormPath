# Start here (no coding knowledge needed)

You are only clicking installs, opening a file, and pasting a few commands. **You do not need to learn programming.**

---

## Part 1 — Install Node (one time)

Node.js is a small program the map app needs. The website changes its colors sometimes — **ignore the color**. What matters is the **word LTS**.

### A. On the Node website

1. Open your browser and go to: **https://nodejs.org**
2. You should see **two** download choices (e.g. **LTS** and **Current**).
3. Choose the one labeled **LTS** (Long Term Support). It might be **blue**, **green**, or another color — that’s fine. **Do not pick “Current”** unless you already know you want it.
4. Your browser will download a file. On Windows it usually ends in **`.msi`** (for example `node-v22.x.x-x64.msi`).

### B. If Windows shows a scary security screen

This is normal for many installers.

- If it says **“Windows protected your PC”** or **“Microsoft Defender SmartScreen”**:
  1. Click **More info** (sometimes small text).
  2. Then click **Run anyway**.

You are installing official software from **nodejs.org**. This warning appears because the file was just downloaded, not because something is wrong.

### C. The Node installer wizard

1. Open the **`.msi`** file from your **Downloads** folder (double‑click it).
2. Click **Next**.
3. Accept the license → **Next**.
4. Leave the install folder as‑is → **Next**.
5. On the **“Tools for Native Modules”** / **automatically install necessary tools** screen (if you see it): **uncheck** that box so you don’t get an extra confusing script — you don’t need it for this project. Then **Next**.
6. Click **Install**. If Windows asks for permission, click **Yes**.
7. When it finishes, click **Finish**.

### D. After it’s done

**Close Cursor completely** and open it again (so it sees Node). Then continue to Part 3.

---

## Part 2 — Put your keys in the right file

The app reads a file named **`.env`** (not `.env.example`).

1. In Cursor, look at the **left file list** for this project.
2. Open the folder **`web`**, then open the file **`.env`**.
   - If you **don’t** see `.env`, only `.env.example`: tell the AI assistant in chat *“create my web/.env file”* and paste your three keys when asked, **or** copy `.env.example`, rename the copy to `.env`, then paste your keys into `.env`.
3. You should see three lines like:
   - `VITE_MAPBOX_TOKEN=...`
   - `VITE_ORS_API_KEY=...`
   - `VITE_OPENWEATHER_API_KEY=...`
4. Make sure your **real** keys are **after** each `=` sign, then **save** the file (Ctrl+S).

---

## Part 3 — Start the app (every time you want to try it)

### Option A — Double‑click (easiest)

1. In **File Explorer**, go to your project folder, then open **`web`**.
2. Double‑click **`RUN_APP.bat`**.
3. A black window will open. You should see **two** links:
   - **Local** — `http://localhost:5173` → use this **only on the same PC**.
   - **Network** — `http://192.168.x.x:5173` (numbers vary) → use this **on your phone**.
4. **On your phone:** it must be on the **same Wi‑Fi** as the PC. Open the phone’s browser (Chrome, Safari, etc.) and type the **Network** address **exactly** (including `http://` and the port `:5173`).  
   - **Do not** use `localhost` on the phone — that means “this phone,” not your computer, so it will not work.

If the phone says it can’t connect, Windows Firewall may be blocking Node the first time — when a popup appears, allow access for **private networks**. If there’s no popup, search Windows for **“Allow an app through Windows Firewall”** and ensure **Node.js** is allowed on **Private** networks.

When you’re done, close the black window to stop the app.

---

## Part 4 — Put it on Netlify (drag and drop, like your other sites)

You are **not** typing commands by hand for this. One double‑click builds a folder; then you drag that folder like you already do.

### One time first

Make sure **Part 1** (Node) and **Part 2** (`.env` with your keys) are done. The build bakes those keys into the site so the map works on your phone.

### Every time you want to update the live site

1. In **File Explorer**, open your project’s **`web`** folder (same place as `RUN_APP.bat`).
2. Double‑click **`BUILD_FOR_NETLIFY.bat`**.
3. Wait until the black window says **Done** and **File Explorer** opens a folder named **`dist`**.
4. Go to **Netlify Drop** (or your other app) and **drag that `dist` folder** the same way you do for other projects.  
   - If the site only accepts a **zip**: open **`dist`**, select **everything inside** (all files and the `assets` folder), right‑click → **Compress to ZIP file**, then upload that zip.

5. Netlify will show you a link like **`https://something.netlify.app`**. Open that link **on your phone** to use the app.

**You never need to open “the files” and run commands yourself** — only double‑click `BUILD_FOR_NETLIFY.bat`. If anything errors, copy the **red or white text** from the black window (not your secret keys) and ask for help.

### Option B — From Cursor

1. In Cursor, press **Ctrl + `** (backtick) or use the menu **Terminal → New Terminal**.
2. **Copy** this whole line, **paste** into the terminal, press **Enter**:

```text
cd "c:\Users\bpeck\OneDrive - Tech Electronics, Incorporated\Desktop\New folder\New Idea\web"
```

3. Then type or paste this and press **Enter**:

```text
npm install
```

Wait until it finishes (may take a minute the first time).

4. Then type or paste this and press **Enter**:

```text
npm run dev -- --host
```

5. You’ll see **Local** and **Network** links. Use **Network** on your phone (same Wi‑Fi); use **Local** on the PC.

---

## If something goes wrong

- **Works on PC but not on phone (local testing)** — You must use the **Network** `http://192.168…:5173` address on the phone, not `localhost`. PC and phone must be on the **same Wi‑Fi**. Allow Node through **Windows Firewall** (see Part 3).
- **Netlify opens on phone but map is blank** — In [Mapbox Account → Access tokens](https://account.mapbox.com/access-tokens/), edit your token’s **URL restrictions** and add your site, e.g. `https://yoursite.netlify.app/*` (or turn restrictions off while testing).
- **“npm is not recognized”** — Node didn’t install or you need to **close and reopen** Cursor (and the terminal) after installing Node.
- **Map is blank** — Open **`web/.env`** and check that **`VITE_MAPBOX_TOKEN=`** has your Mapbox key after the `=`. Save, then run **`RUN_APP.bat`** again.
- **Drive times** — OpenRouteService plans the path and a baseline time; **Mapbox** (same token as the map) supplies **live traffic** on that path. Weather samples use **OpenWeather** if that key is set.

You can always say in chat: *“I’m stuck on step X and this is what I see: …”* and paste the **exact** message from the screen (not your secret keys).

---

## Phone layout

Narrow screens (**about 520px wide and below**) use a **`@media (max-width: 520px)`** block at the **end** of **`web/src/App.css`**: smaller type and padding for the top turn/hazard strip, right rail, bottom search dock, saved drawer, and a **smaller route PiP** (120px) with updated offsets. If something still feels big on your device, tweak that block or say *“tighten mobile more”* in chat.

---

## Weather + radar (for builders / curious drivers)

- **Rad** on the map **animates** through recent RainViewer frames (and **nowcast** when their API provides it).
- **Routes do not automatically dodge storms** — see **`web/WEATHER_ROUTING_VISION.md`** for what’s possible today, when automation **breaks down**, and a sketch of a future storm-aware loop.
