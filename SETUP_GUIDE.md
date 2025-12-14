# Nexporify - Setup and Development Guide

## What is Nexporify?

Nexporify is an enhanced, open-source fork of Exportify that allows you to export your Spotify playlist data to CSV format and explore it through beautiful, artistic data visualizations. It uses the Spotify Web API to fetch playlist metadata including:

- Track information (name, artist, album, duration, popularity)
- Audio features (danceability, energy, tempo, valence, etc.)
- Release dates, genres, record labels
- Playlist metadata (when tracks were added, by whom)

Nexporify features a redesigned, artistic interface with dark mode, immersive data visualizations, and enhanced playlist management features including search, sort, and multiple view modes. The exported data can be analyzed using the included Jupyter notebook (`taste_analysis.ipynb`), or explored directly through the built-in analysis page with interactive charts and visualizations.

## Repository Status

✅ **Enhanced fork with artistic redesign and new features**

- **Your fork**: `https://github.com/visheshvs/exportify.git` (origin)
- **Original repo**: `https://github.com/pavelkomarov/exportify.git` (upstream)
- **Current branch**: `master`
- **Status**: Enhanced version with redesigned UI, new features, and improved user experience

## Project Structure

```
exportify/
├── index.html                    # Main web interface
├── exportify.js                  # Core JavaScript logic (Spotify API integration)
├── styles/
│   └── artistic-theme.css        # Custom artistic design system (dark mode, modern UI)
├── FileSaver.js                  # Library for saving files
├── taste_analysis.ipynb          # Jupyter notebook for data analysis
├── requirements.txt              # Python dependencies
├── README.md                     # Project documentation
└── SETUP_GUIDE.md               # This setup guide
```

## Key Technologies

- **Frontend**: Vanilla JavaScript, React (via CDN), Custom CSS Design System
- **Styling**: Custom artistic theme with dark mode, gradients, and modern UI components
- **Charts**: ApexCharts for interactive data visualizations
- **Backend**: None (runs entirely client-side)
- **API**: Spotify Web API (uses PKCE flow for authentication)
- **Analysis**: Built-in analysis page with charts, plus Python (pandas, matplotlib, scikit-learn, seaborn) via Jupyter notebook

## Prerequisites

### For Web Application:
- A modern web browser (Chrome, Firefox, Edge, Safari)
- Python 3.x (for local development server)
- **No Node.js required** - this is a pure client-side app

### For Data Analysis:
- Python 3.x
- Jupyter Notebook
- Dependencies from `requirements.txt`

## How to Run Locally

### Option 1: Python HTTP Server (Recommended)

1. **Navigate to the exportify directory:**
   ```powershell
   cd C:\Users\vishe\Documents\Github\exportify
   ```

2. **Start a local web server:**
   ```powershell
   python -m http.server 8000
   ```
   (Or use `python3` if you have both Python 2 and 3 installed)

3. **Open in browser:**
   - Go to: `http://localhost:8000`
   - Or: `http://127.0.0.1:8000`
   - Or: `http://[::1]:8000` (IPv6)

4. **Click "Get Started"** to authenticate with Spotify and start exporting playlists!

### Option 2: Other Web Servers

You can use any local web server. For example:
- **Node.js**: `npx http-server -p 8000`
- **PHP**: `php -S localhost:8000`
- **VS Code**: Use the "Live Server" extension

**Important**: The app must be served over HTTP/HTTPS (not `file://`) because:
- It uses `fetch()` API which requires HTTP
- Spotify OAuth redirects need a proper origin
- CORS policies require HTTP

## Spotify API Setup

### Using the Existing Client ID (For Local Development)

The app includes a **hardcoded client ID** (`d99b082b01d74d61a100c9a0e056380b`) that's already configured in the code. This client ID has redirect URIs configured for:
- `http://localhost:8000`
- `http://127.0.0.1:8000`
- `http://[::1]:8000`
- `https://exportify.net` (original production site)

**For local development**, you can use this client ID without any changes.

### Using Existing Client ID for GitHub Pages (If You Have Access)

**Can you use the existing credentials for your hosted version?**

- **YES**, if you have access to the Spotify Developer Dashboard for client_id `d99b082b01d74d61a100c9a0e056380b`
- You need to add your GitHub Pages URL to the Redirect URIs list in the Spotify app settings
- Example: `https://yourusername.github.io/exportify` (replace with your actual GitHub Pages URL)

**Steps:**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Find the app with client_id `d99b082b01d74d61a100c9a0e056380b`
3. Click "Edit Settings"
4. Add your GitHub Pages URL to the "Redirect URIs" list
5. Click "Add" and "Save"
6. Your hosted version will now work with the existing client ID

### Creating Your Own Spotify App (Recommended for Forks)

**If you don't have access to the existing app**, you MUST create your own Spotify app:

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create app"
3. Fill in:
   - **App name**: "Nexporify" (or your preferred name)
   - **App description**: "Export and analyze Spotify playlists"
   - **Redirect URI**: Add your GitHub Pages URL (e.g., `https://yourusername.github.io/exportify`)
   - **Redirect URI**: Also add `http://localhost:8000` for local development
4. Click "Save"
5. Copy your **Client ID** from the app dashboard
6. Update `exportify.js`:
   - Line 20: Replace `d99b082b01d74d61a100c9a0e056380b` with your new client_id
   - Line 2953: Replace `d99b082b01d74d61a100c9a0e056380b` with your new client_id

**Important Notes:**
- Redirect URIs must match **exactly** (including protocol, domain, and path)
- You can add multiple redirect URIs for different environments (localhost, GitHub Pages, custom domain)
- The app uses PKCE flow, so no client secret is needed

## Running the Analysis Notebook

1. **Install Python dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```
   
   This installs:
   - matplotlib
   - pandas
   - scipy
   - seaborn
   - scikit-learn
   - numpy

2. **Start Jupyter Notebook:**
   ```powershell
   jupyter notebook
   ```
   
   Or if you prefer JupyterLab:
   ```powershell
   jupyter lab
   ```

3. **Open `taste_analysis.ipynb`** in the browser

4. **Export a playlist** from the web app first to get a CSV file

5. **Update the filename** in the first code cell:
   ```python
   filename = 'your_playlist_name.csv'
   ```

6. **Run all cells** to generate visualizations

## How It Works

### Authentication Flow (PKCE)
1. User clicks "Get Started"
2. App generates a random `code_verifier` and hashes it to create `code_challenge`
3. User is redirected to Spotify authorization page
4. After login, Spotify redirects back with an authorization code
5. App exchanges the code + verifier for an access token
6. Token is stored in `localStorage` for subsequent API calls

### Data Export Process
1. Fetches all user playlists (including "Liked Songs")
2. For each playlist, fetches all tracks (handles pagination)
3. For each track, fetches:
   - Track metadata
   - Audio features
   - Artist genres
4. Compiles everything into CSV format
5. Downloads as `.csv` file using FileSaver.js

### Rate Limiting
- The app includes automatic rate limiting with delays between requests
- Handles 429 (Too Many Requests) responses with exponential backoff
- Handles 502 (Bad Gateway) errors with retries

## Development Tips

### Key Files to Understand:

1. **`exportify.js`** - Main logic:
   - `utils.authorize()` - OAuth PKCE flow
   - `utils.apiCall()` - API request wrapper with error handling
   - `PlaylistTable` - React component for displaying playlists
   - `exportPlaylist()` - Main export function

2. **`index.html`** - HTML structure with:
   - Custom artistic theme CSS
   - React from CDN
   - Hero section and layout structure
   - Button bindings

3. **`styles/artistic-theme.css`** - Custom design system:
   - Dark mode color palette
   - Typography scale
   - Component styles (cards, buttons, forms)
   - Animations and transitions
   - Responsive breakpoints

### Common Modifications:

- **Change export format**: Modify `exportPlaylist()` function in `exportify.js`
- **Add new fields**: Update CSV headers and data fetching in `exportify.js`
- **Customize UI**: Edit `index.html` and `styles/artistic-theme.css`
- **Add features**: Extend `utils` object or create new React components
- **Modify design**: Update CSS variables in `artistic-theme.css` for colors, spacing, etc.

## Troubleshooting

### "CORS error" or "Failed to fetch"
- Make sure you're using a web server (not opening `file://`)
- Check that the server is running on the correct port

### "Invalid redirect URI"
- The redirect URI must match exactly what's configured in Spotify Dashboard
- For localhost, use `http://localhost:8000` (not `http://127.0.0.1:8000` unless configured)

### "401 Unauthorized"
- Token expired - just click "Get Started" again to re-authenticate
- The app automatically redirects to home on 401 errors

### Rate Limiting Issues
- The app handles this automatically, but if you see warnings, wait a bit
- Spotify allows ~100 requests per second per app

## Deploying to GitHub Pages

GitHub Pages provides free hosting for static websites. Here's how to deploy Nexporify:

### Step 1: Enable GitHub Pages

1. Go to your repository on GitHub: `https://github.com/visheshvs/exportify`
2. Click on **Settings** (top menu)
3. Scroll down to **Pages** (left sidebar)
4. Under **Source**, select:
   - **Branch**: `master` (or `main` if that's your default branch)
   - **Folder**: `/ (root)`
5. Click **Save**
6. GitHub will provide your site URL: `https://visheshvs.github.io/exportify`

### Step 2: Configure Spotify Redirect URI

**If using existing client ID:**
- Add your GitHub Pages URL to the Spotify app's redirect URIs (see Spotify API Setup section above)

**If using your own app:**
- Make sure your GitHub Pages URL is already in the redirect URIs list

### Step 3: Update Canonical URL (Optional)

Update `index.html` line 10 to reflect your GitHub Pages URL:
```html
<link rel="canonical" href="https://visheshvs.github.io/exportify">
```

### Step 4: Test Your Deployment

1. Wait a few minutes for GitHub Pages to build (you'll see a green checkmark when ready)
2. Visit your GitHub Pages URL
3. Click "Get Started" and test the Spotify authentication
4. Verify that playlists load correctly

### Custom Domain (Optional)

1. In GitHub Pages settings, enter your custom domain
2. Add a `CNAME` file in your repository root with your domain name
3. Update DNS records as instructed by GitHub
4. Add your custom domain to Spotify app redirect URIs

### Troubleshooting GitHub Pages

- **404 Error**: Make sure `index.html` is in the root directory
- **Authentication fails**: Verify redirect URI matches exactly in Spotify Dashboard
- **Styles not loading**: Check that `styles/artistic-theme.css` path is correct
- **Changes not appearing**: Clear browser cache or wait a few minutes for GitHub to rebuild

## Keeping Up to Date

To sync with upstream changes from the original Exportify repository:

```powershell
cd C:\Users\vishe\Documents\Github\exportify
git fetch upstream
git merge upstream/master
```

Or if you want to see what's new first:
```powershell
git log HEAD..upstream/master --oneline
```

**Note**: After merging upstream changes, you may need to resolve conflicts if you've modified shared files. Your customizations (artistic theme, new features) are in files that shouldn't conflict.

## Next Steps

1. ✅ Repository cloned and synced
2. Run the web app locally to test it
3. Export a test playlist
4. Try the analysis notebook
5. Explore the code to understand how it works
6. Make your own modifications!

## Resources

- [Spotify Web API Documentation](https://developer.spotify.com/documentation/web-api)
- [Spotify Audio Features Reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)
- [PKCE Flow Explanation](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Original Exportify Site](https://exportify.net)
- [Original Repository](https://github.com/pavelkomarov/exportify)
- [GitHub Discussions](https://github.com/pavelkomarov/exportify/discussions)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)

---

Happy exporting! 🎵

