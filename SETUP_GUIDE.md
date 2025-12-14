# Exportify - Setup and Development Guide

## What is Exportify?

Exportify is a web application that allows you to export your Spotify playlist data to CSV format. It uses the Spotify Web API to fetch playlist metadata including:

- Track information (name, artist, album, duration, popularity)
- Audio features (danceability, energy, tempo, valence, etc.)
- Release dates, genres, record labels
- Playlist metadata (when tracks were added, by whom)

The exported data can then be analyzed using the included Jupyter notebook (`taste_analysis.ipynb`).

## Repository Status

✅ **Your fork is now synced with upstream!** 

- **Your fork**: `https://github.com/visheshvs/exportify.git` (origin)
- **Original repo**: `https://github.com/pavelkomarov/exportify.git` (upstream)
- **Current branch**: `master`
- **Status**: Up to date with upstream (just synced 2 commits)

## Project Structure

```
exportify/
├── index.html              # Main web interface
├── exportify.js            # Core JavaScript logic (Spotify API integration)
├── style.css               # Styling
├── FileSaver.js            # Library for saving files
├── taste_analysis.ipynb    # Jupyter notebook for data analysis
├── requirements.txt        # Python dependencies
└── README.md               # Original project documentation
```

## Key Technologies

- **Frontend**: Vanilla JavaScript, React (via CDN), Bootstrap
- **Backend**: None (runs entirely client-side)
- **API**: Spotify Web API (uses PKCE flow for authentication)
- **Analysis**: Python (pandas, matplotlib, scikit-learn, seaborn)

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

The app uses a **hardcoded client ID** (`d99b082b01d74d61a100c9a0e056380b`) that's already configured in the code. This client ID is registered with Spotify and has redirect URIs configured for:
- `http://localhost:8000`
- `http://127.0.0.1:8000`
- `http://[::1]:8000`
- `https://exportify.net` (production)

**You don't need to create your own Spotify app** unless you want to customize the redirect URIs or use different scopes.

### If You Need Your Own Spotify App:

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Add redirect URIs (must match exactly what you're using)
4. Update `client_id` in `exportify.js` line 20

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

2. **`index.html`** - Simple HTML structure with:
   - Bootstrap for styling
   - React from CDN
   - Button bindings

### Common Modifications:

- **Change export format**: Modify `exportPlaylist()` function
- **Add new fields**: Update CSV headers and data fetching
- **Customize UI**: Edit `index.html` and `style.css`
- **Add features**: Extend `utils` object or create new React components

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

## Keeping Up to Date

To sync with upstream changes in the future:

```powershell
cd C:\Users\vishe\Documents\Github\exportify
git fetch upstream
git merge upstream/master
```

Or if you want to see what's new first:
```powershell
git log HEAD..upstream/master --oneline
```

## Next Steps

1. ✅ Repository cloned and synced
2. Run the web app locally to test it
3. Export a test playlist
4. Try the analysis notebook
5. Explore the code to understand how it works
6. Make your own modifications!

## Resources

- [Spotify Web API Documentation](https://developer.spotify.com/documentation/web-api)
- [PKCE Flow Explanation](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Original Exportify Site](https://exportify.net)
- [GitHub Discussions](https://github.com/pavelkomarov/exportify/discussions)

---

Happy exporting! 🎵

