
[![Build Status](https://github.com/pavelkomarov/exportify/actions/workflows/deploy.yml/badge.svg)](https://github.com/pavelkomarov/exportify/actions)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/pavelkomarov/exportify/master)

**Nexporify** - An enhanced, open-source fork of [Exportify](https://exportify.net) with an artistic redesign and new features.

Export your Spotify playlist metadata for analysis or just safekeeping, with beautiful data visualizations and an improved user experience.

🌐 **Live Demo**: [GitHub Pages](https://visheshvs.github.io/exportify) (if deployed)

📦 **Original Project**: [exportify.net](https://exportify.net) by [pavelkomarov](https://github.com/pavelkomarov/exportify)

<a href="https://pavelkomarov.com/exportify"><img src="screenshot.png"/></a>

### Export Format

Playlist data is exported in [CSV](http://en.wikipedia.org/wiki/Comma-separated_values) format with the following fields:

- [Track URI](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids)
- Track Name
- Album Name
- Artist Name(s)
- Release Date
- Duration (ms)
- Popularity
- Explicit
- Added By
- Added At
- Genres
- Record Label
- Danceability
- Energy
- Key
- Loudness
- Mode (Major or Minor)
- Speechiness
- Acousticness
- Instrumentalness
- Liveness
- Valence
- Tempo
- Time Signature

### Analysis

Run the [Jupyter Notebook](https://github.com/pavelkomarov/exportify/blob/master/taste_analysis.ipynb) or [launch it in Binder](https://mybinder.org/v2/gh/pavelkomarov/exportify/master) to get a variety of plots about the music in a playlist including:

- Most common artists
- Most common genres
- Release date distribution
- Popularity distribution
- Your songs' distributions of Acousticness, Valence, etc.
- Time signatures and keys
- All songs plotted in 2D to indicate relative similarities


### New Features in Nexporify

- 🎨 **Artistic Design**: Dark mode with modern UI, gradients, and smooth animations
- 🔍 **Search & Sort**: Find and organize playlists with real-time search and multiple sort options
- 📊 **Built-in Analysis**: Interactive data visualizations on the analysis page
- 🎯 **Multiple Views**: Toggle between card and list views for playlists
- 📱 **Responsive**: Optimized for all screen sizes with compact, margin-constrained layout

### Development

Most of the interesting logic that communicates with the Spotify Web API happens in Javascript in `exportify.js`. The redesigned UI uses a custom CSS design system in `styles/artistic-theme.css`. The webpage structure and bindings are defined in `index.html`.

To experiment with changes, run a local web server. For example, using Python (in the Nexporify repo dir):

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) or [http://[::1]:8000](http://[::1]:8000). The Javascript can be invoked by interacting with this locally-served webpage.

Data science analysis is available in two ways:
1. **Built-in Analysis Page**: Click "Analyze" on any playlist for interactive visualizations
2. **Jupyter Notebook**: Run `taste_analysis.ipynb` with `python3 -m notebook`, then navigate to [http://localhost:8888](http://localhost:8888)

### Deployment

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed instructions on:
- Running locally
- Deploying to GitHub Pages
- Setting up Spotify API credentials
- Configuring redirect URIs

### Contributing

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -m "message"`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create a new Pull Request


### Quick Start

```bash
# Run local server
python -m http.server 8000

# Then open http://localhost:8000 in your browser
```

For detailed setup instructions, see [SETUP_GUIDE.md](SETUP_GUIDE.md).
