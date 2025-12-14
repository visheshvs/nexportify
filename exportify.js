// A collection of functions to create and send API queries
const utils = {
	// Send a request to the Spotify server to let it know we want a session. This is literally accomplished by navigating
	// to a web address, which accomplishes a GET, with correct query params in tow. There the user may have to enter their
	// Spotify credentials, after which they are redirected. Which client app wants access, which information exactly it wants
	// access to (https://developer.spotify.com/documentation/web-api/concepts/scopes), where to redirect, etc. constitute the
	// params. Since we now have to do https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow, this
	// accomplishes only the first phase. Essentially we generate a random secret then hash and encode it and send the hashed
	// side (the "challenge") to the authorization server in the original GET. The server responds with a code, which we send
	// back along with the secret (the "verifier") in a POST form, which proves the original request came from the same origin.
	// The auth code is finally sent in the response body to that latter request, instead of as a plaintext url param.
	// https://developer.spotify.com/documentation/web-api/concepts/authorization
	async authorize() { // This is bound to the login button in the HTML and gets called when the login button is clicked.
		let alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
		let code_verifier = crypto.getRandomValues(new Uint8Array(64)).reduce((acc, x) => acc + alphanumeric[x % alphanumeric.length], "")
		let hashed = await crypto.subtle.digest('SHA-256', (new TextEncoder()).encode(code_verifier)) // some crypto methods are async
		let code_challenge = btoa(String.fromCharCode(...new Uint8Array(hashed))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

		localStorage.setItem('code_verifier', code_verifier) // save the random string secret
		// Get full redirect URI including path (for GitHub Pages subdirectory support)
		let redirectUri = location.origin + location.pathname.replace(/\/$/, ''); // Remove trailing slash
		location = "https://accounts.spotify.com/authorize?client_id=d07d8c2ddb3646d4b4fb3781ffc6d2bc" +
			"&redirect_uri=" + encodeURIComponent(redirectUri) +
			"&scope=playlist-read-private%20playlist-read-collaborative%20user-library-read" + // access to particular scopes of info defined here
			"&response_type=code&code_challenge_method=S256&code_challenge=" + code_challenge
	},

	// Make an asynchronous call to the server. Promises are *weird*. Careful here! You have to call .json() on the
	// Promise returned by the fetch to get a second Promise that has the actual data in it!
	// https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
	// https://eloquentjavascript.net/11_async.html
	async apiCall(url, delay=0, bad_gateway_retries=2) {
		await new Promise(r => setTimeout(r, delay)) // JavaScript equivalent of sleep(delay), to stay under rate limits ;)
		const accessToken = localStorage.getItem('access_token');
		if (!accessToken) {
			console.error('No access token found. Please re-authenticate.');
			location = location.origin + location.pathname.split('#')[0].split('?')[0];
			return;
		}
		let response = await fetch(url, { headers: { 'Authorization': 'Bearer ' + accessToken} })
		if (response.ok) { 
			const data = await response.json();
			// Log audio-features API calls for debugging
			if (url.includes('audio-features')) {
				console.log('Audio features API call successful:', url);
				console.log('Response structure:', {
					hasAudioFeatures: !!data.audio_features,
					audioFeaturesLength: data.audio_features?.length,
					sampleFeature: data.audio_features?.[0]
				});
			}
			return data;
		}
		else if (response.status == 401) { 
			console.error('401 Unauthorized - Token expired or invalid. Please re-authenticate.');
			// Return to home page after auth token expiry, maintaining subdirectory path
			location = location.origin + location.pathname.split('#')[0].split('?')[0]
		}
		else if (response.status == 403) {
			const errorText = await response.text();
			console.error('403 Forbidden - Access denied to:', url);
			console.error('Error details:', errorText);
			if (url.includes('audio-features')) {
				console.error('Audio features endpoint returned 403. This usually means:');
				console.error('1. The access token is invalid or expired');
				console.error('2. The token was issued by a different Spotify app');
				console.error('3. The token needs to be refreshed');
				console.error('Current access token (first 20 chars):', accessToken?.substring(0, 20));
				
				// Clear the invalid token and force re-authentication
				localStorage.removeItem('access_token');
				localStorage.removeItem('access_token_timestamp');
				
				// Show user-friendly error
				if (typeof error !== 'undefined' && error) {
					error.innerHTML = '<p style="color: #ff6b6b; font-size: 18px; margin-bottom: 20px;">⚠️ Audio Features Access Denied</p>' +
						'<p>The access token does not have permission to fetch audio features. This usually happens when:</p>' +
						'<ul style="text-align: left; display: inline-block; margin: 20px 0;">' +
						'<li>You created a new Spotify app but are using an old access token</li>' +
						'<li>The access token has expired or is invalid</li>' +
						'</ul>' +
						'<p><strong>Solution:</strong> The invalid token has been cleared. Please click "Get Started" to re-authenticate.</p>' +
						'<p style="margin-top: 20px;"><button onclick="location.reload()" style="padding: 10px 20px; background: #1DB954; color: white; border: none; border-radius: 5px; cursor: pointer;">Refresh Page & Re-authenticate</button></p>';
				}
				
				// Return empty features array to allow export to continue without features
				return { audio_features: [] };
			}
			throw new Error('403 Forbidden: ' + errorText);
		}
		else if (response.status == 429) {
			//if (!error.innerHTML.includes("fa-bolt")) { error.innerHTML += '<p><i class="fa fa-bolt" style="font-size: 50px; margin-bottom: 20px">\
			//	</i></p><p>Exportify has encountered <a target="_blank" href="https://developer.spotify.com/documentation/web-api/concepts/rate-limits">\
			//	rate limiting</a> while querying endpoint ' + url.split('?')[0] + '!<br/>Don\'t worry: Automatic backoff is implemented, and your data is \
			//	still downloading. But <a href="https://github.com/pavelkomarov/exportify/issues">I would be interested to hear about this.</a></p><br/>' }
			return utils.apiCall(url, response.headers.get('Retry-After')*1000) } // API Rate-limiting encountered, so tail-call replacement request on a delay
		else if (response.status == 502 && bad_gateway_retries > 0) {
			if (!error.innerHTML.includes("fa-bolt")) { error.innerHTML += '<p><i class="fa fa-bolt" style="font-size: 50px; margin-bottom: 20px">\
				</i></p><p>Exportify has encountered a <a target="_blank" href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/502">\
				bad gateway</a> while querying endpoint ' + url.split('?')[0] + '!<br/>Retries are implemented, so your download may still succeed. \
				But <a href="https://github.com/pavelkomarov/exportify/issues">I would be interested to hear about this.</a></p><br/>' }
            return utils.apiCall(url, (3-bad_gateway_retries)*1000, bad_gateway_retries-1) }
		else { error.innerHTML = "The server returned an unhandled kind of HTTP response: " + response.status } // the caller will fail
	},

	// Logging out of Spotify is much like logging in: You have to navigate to a certain url. But unlike logging in, there is
	// no way to redirect back to my home page. So open the logout page in a new tab, then redirect to the homepage after a
	// second, which is almost always long enough for the logout request to go through. Scratch that: just wipe data and reload page.
	logout() {
		localStorage.clear() // otherwise when the page is reloaded it still just finds and uses the access_token
		// Logout: redirect to home page, maintaining subdirectory path
		location = location.origin + location.pathname.split('#')[0].split('?')[0] //let logout = open("https://www.spotify.com/logout"); setTimeout(() => {logout.close(); location = location.origin + location.pathname}, 1000)
	}
}

// The table of this user's playlists, to be displayed mid-page in the playlistsContainer
class PlaylistTable extends React.Component {
	// By default the constructor passes properties to super.
	constructor(props) { super(props) } //render() gets called at the end of constructor execution

	// A constructor can't be async, but we need to asynchronously load data when the object is made.
	// Solve this with a separate function that initializes object data. Call it from render().
	// https://stackoverflow.com/questions/43431550/how-can-i-invoke-asynchronous-code-within-a-constructor
	async init() {
		let user = await utils.apiCall("https://api.spotify.com/v1/me")
		let library = await utils.apiCall("https://api.spotify.com/v1/me/tracks?offset=0&limit=1")

		// fake a playlist-like structure for the liked songs, so it plays well with the rest of the code
		let liked_songs = {name: "Liked Songs", external_urls: {spotify: "https://open.spotify.com/collection/tracks"},
			images:[{url: "liked_songs.jpeg"}], owner: {id: user.id, external_urls: {spotify: user.external_urls.spotify}},
			tracks: {total: library.total, href: "https://api.spotify.com/v1/me/tracks"}}
		let playlists = [[liked_songs]] // double list so .flat() flattens everything right later

		// Compose a list of all the user's playlists by querying the playlists endpoint. Their total number of playlists
		// needs to be garnered from a response, so await the first response, then send a volley of requests to get the rest.
		// https://developer.spotify.com/documentation/web-api/reference/get-list-users-playlists
		let response = await utils.apiCall("https://api.spotify.com/v1/me/playlists?limit=50&offset=0")
		playlists.push(response.items)
		let requests = []
		for (let offset = 50; offset < response.total; offset += 50) {
			requests.push(utils.apiCall("https://api.spotify.com/v1/me/playlists?limit=50&offset=" + offset, 2*offset-100))
		}
		await Promise.all(requests).then(responses => responses.map(response => playlists.push(response.items)))

		//add info to this Component's state. Use setState() so render() gets called again.
		const flatPlaylists = playlists.flat();
		this.setState({ 
			playlists: flatPlaylists,
			allPlaylists: flatPlaylists // Keep original for filtering
		}) // flatten list of lists into just a list
		if (subtitle) {
			subtitle.textContent = flatPlaylists.length + ' playlists discovered'
		}
		// Show explore button
		const exploreButtonContainer = document.getElementById('exploreButtonContainer');
		if (exploreButtonContainer) {
			exploreButtonContainer.style.display = 'block';
		}
	}

	// Make the table sortable
	sortRows(column) {
		// Change arrow icons appropriately
		let allSorts = Array.from(document.querySelectorAll('[id^="sortBy"]')) // querySelectorAll returns NodeList, not Array https://eloquentjavascript.net/14_dom.html#h-5ooQzToxht https://developer.mozilla.org/en-US/docs/Web/API/NodeList
		let arrow = allSorts.find(el => el.id == "sortBy"+column) // find the one just clicked
		allSorts.forEach(el => { if (el != arrow) {el.className = "fa fa-fw fa-sort"; el.style.color = '#C0C0C0'} }) // change the other two back to the greyed-out double-arrow
		if (arrow.className.endsWith("fa-sort") || arrow.className.endsWith("fa-sort-asc")) { arrow.className = "fa fa-fw fa-sort-desc" } //if the icon is fa-sort or asc, change to desc
		else if (arrow.className.endsWith("fa-sort-desc")) { arrow.className = "fa fa-fw fa-sort-asc" } //if descending, change to ascending
		arrow.style.color = "#000000" // darken
		
		// rearrange table rows
		function field(p) { // get the keyed column contents
			if (column == "Name") { return p.name } else if (column == "Owner") { return p.owner.id } }
		this.setState({ playlists: this.state.playlists.sort((a, b) => // make sure to use setState() so React reacts! Calling render() doesn't cut the mustard.	
			arrow.className.endsWith("desc") ? // figure out whether we're ascending or descending
				column == "Tracks" ? a.tracks.total - b.tracks.total : field(a).localeCompare(field(b)) : // for numeric column, just use the difference to get a + or - number
				column == "Tracks" ? b.tracks.total - a.tracks.total : field(b).localeCompare(field(a))) }) // for string columns, use something fancier to handle capitals and such
	}

	// Sort playlists
	sortPlaylists(sortBy, direction) {
		if (sortBy === 'default') {
			// Reset to original order
			const originalPlaylists = this.state.allPlaylists || this.state.playlists;
			this.setState({ playlists: [...originalPlaylists], sortBy: 'default', sortDirection: 'asc', hasBeenSorted: false });
			return;
		}
		
		const playlistsToSort = this.state.playlists || [];
		const sorted = [...playlistsToSort].sort((a, b) => {
			let aVal, bVal;
			if (sortBy === 'name') {
				aVal = a.name.toLowerCase();
				bVal = b.name.toLowerCase();
			} else if (sortBy === 'owner') {
				aVal = a.owner.id.toLowerCase();
				bVal = b.owner.id.toLowerCase();
			} else if (sortBy === 'tracks') {
				aVal = a.tracks.total;
				bVal = b.tracks.total;
			} else {
				return 0;
			}
			
			if (typeof aVal === 'string') {
				return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
			} else {
				return direction === 'asc' ? aVal - bVal : bVal - aVal;
			}
		});
		this.setState({ playlists: sorted, sortBy: sortBy, sortDirection: direction, hasBeenSorted: true });
	}

	// Filter playlists by search term
	filterPlaylists(searchTerm) {
		const sourcePlaylists = this.state.allPlaylists || this.state.playlists;
		if (!searchTerm || searchTerm.trim() === '') {
			this.setState({ playlists: sourcePlaylists, searchTerm: '' });
			return;
		}
		const filtered = sourcePlaylists.filter(playlist => {
			const searchLower = searchTerm.toLowerCase();
			return playlist.name.toLowerCase().includes(searchLower) ||
				   playlist.owner.id.toLowerCase().includes(searchLower) ||
				   playlist.tracks.total.toString().includes(searchLower);
		});
		this.setState({ playlists: filtered, searchTerm: searchTerm });
	}

	// createElement is a legacy API https://react.dev/reference/react/createElement, but I like it better than JSX at the moment
	// https://stackoverflow.com/questions/78433001/why-is-createelement-a-part-of-the-legacy-api
	render() {
		if (this.state?.playlists.length > 0) {
			const viewMode = this.state.viewMode || 'cards';
			const sortBy = this.state.sortBy || 'default';
			const sortDirection = this.state.sortDirection || 'asc';
			const searchTerm = this.state.searchTerm || '';
			
			// Apply default sorting on first render if not sorted
			if (!this.state.hasBeenSorted && this.state.playlists.length > 0 && sortBy === 'default') {
				// Keep original order (already sorted by Spotify API)
				this.setState({ hasBeenSorted: true });
			}
			
			return React.createElement("div", { id: "playlists", className: viewMode === 'cards' ? "playlists-grid" : "playlists-list" },
				// Controls at the top
				React.createElement("div", { 
					className: "playlists-controls",
					style: { 
						gridColumn: "1 / -1", 
						display: "flex", 
						flexWrap: "wrap",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "var(--space-md)",
						marginBottom: "var(--space-lg)" 
					} },
					React.createElement("div", {
						style: {
							display: "flex",
							gap: "var(--space-sm)",
							alignItems: "center",
							flex: "1",
							minWidth: "200px"
						}
					},
						React.createElement("input", {
							type: "text",
							className: "playlist-search",
							placeholder: "Search playlists...",
							value: searchTerm,
							onChange: (e) => this.filterPlaylists(e.target.value)
						}),
						React.createElement("select", {
							className: "playlist-sort",
							value: sortBy === 'default' ? 'default' : sortBy + '-' + sortDirection,
							onChange: (e) => {
								if (e.target.value === 'default') {
									this.sortPlaylists('default', 'asc');
								} else {
									const [sort, dir] = e.target.value.split('-');
									this.sortPlaylists(sort, dir);
								}
							}
						},
							React.createElement("option", { value: "default" }, "Default"),
							React.createElement("option", { value: "name-asc" }, "Name (A-Z)"),
							React.createElement("option", { value: "name-desc" }, "Name (Z-A)"),
							React.createElement("option", { value: "tracks-asc" }, "Tracks (Fewest)"),
							React.createElement("option", { value: "tracks-desc" }, "Tracks (Most)"),
							React.createElement("option", { value: "owner-asc" }, "Owner (A-Z)"),
							React.createElement("option", { value: "owner-desc" }, "Owner (Z-A)")
						)
					),
					React.createElement("div", {
						style: {
							display: "flex",
							gap: "var(--space-sm)"
						}
					},
						React.createElement("button", {
							className: "btn btn-action" + (viewMode === 'cards' ? ' active' : ''),
							type: "button",
							onClick: () => this.setState({ viewMode: 'cards' }),
							title: "Card View"
						}, "⊞"),
						React.createElement("button", {
							className: "btn btn-action" + (viewMode === 'list' ? ' active' : ''),
							type: "button",
							onClick: () => this.setState({ viewMode: 'list' }),
							title: "List View"
						}, "☰")
					),
					React.createElement("button", { 
						className: "btn btn-action", 
						type: "submit", 
						id: "exportAll",
						onClick: () => PlaylistExporter.exportAll(this.state.playlists) 
					}, "Export All")),
				// Playlist items (cards or list)
				this.state.playlists.map((playlist, i) =>
					viewMode === 'cards' ?
					React.createElement("div", { 
						key: i, 
						className: "playlist-card",
						style: { animation: `fadeIn 0.6s ease-out ${i * 0.05}s both` }
					},
						React.createElement("a", { 
							href: playlist.external_urls.spotify, 
							target: "_blank",
							style: { textDecoration: "none", color: "inherit" }
						},
							React.createElement("img", { 
								className: "playlist-cover",
								src: playlist.images?.length > 0 ? playlist.images[0].url : "https://placehold.co/400?text=No+Image", 
								alt: playlist.name,
								onError: function(e) { e.target.src = "https://placehold.co/400?text=No+Image" }
							})
						),
						React.createElement("div", { className: "playlist-info" },
							React.createElement("h3", { className: "playlist-name" }, playlist.name),
							React.createElement("div", { className: "playlist-owner" }, playlist.owner.id),
							React.createElement("div", { className: "playlist-meta" },
								React.createElement("span", null, playlist.tracks.total + " tracks")
							),
							React.createElement("div", { className: "playlist-actions" },
								React.createElement("button", { 
									className: "btn-action", 
									id: "export" + i, 
									onClick: (e) => { e.stopPropagation(); PlaylistExporter.export(this.state.playlists[i], i); }
								}, "Export"),
								React.createElement("button", { 
									className: "btn-action", 
									id: "analyze" + i, 
									onClick: (e) => { e.stopPropagation(); PlaylistExporter.analyze(this.state.playlists[i], i); }
								}, "Analyze")
							)
						)
					) :
					React.createElement("div", { 
						key: i, 
						className: "playlist-list-item",
						style: { animation: `fadeIn 0.6s ease-out ${i * 0.05}s both` }
					},
						React.createElement("div", { className: "playlist-list-content" },
							React.createElement("a", {
								href: playlist.external_urls.spotify,
								target: "_blank",
								style: { textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "var(--space-lg)", flex: 1 }
							},
								React.createElement("img", { 
									className: "playlist-list-cover",
									src: playlist.images?.length > 0 ? playlist.images[0].url : "https://placehold.co/60?text=No+Image", 
									alt: playlist.name,
									onError: function(e) { e.target.src = "https://placehold.co/60?text=No+Image" }
								}),
								React.createElement("div", { className: "playlist-list-info" },
									React.createElement("h3", { className: "playlist-name" }, playlist.name),
									React.createElement("div", { className: "playlist-owner" }, playlist.owner.id),
									React.createElement("div", { className: "playlist-meta" },
										React.createElement("span", null, playlist.tracks.total + " tracks")
									)
								)
							)
						),
						React.createElement("div", { className: "playlist-actions" },
							React.createElement("button", { 
								className: "btn-action", 
								id: "export" + i, 
								onClick: (e) => { e.stopPropagation(); PlaylistExporter.export(this.state.playlists[i], i); }
							}, "Export"),
							React.createElement("button", { 
								className: "btn-action", 
								id: "analyze" + i, 
								onClick: (e) => { e.stopPropagation(); PlaylistExporter.analyze(this.state.playlists[i], i); }
							}, "Analyze")
						)
					)
				)
			)
		} else {
			this.init()
			return React.createElement("div", { className: "spinner"})
		}
	}
}

// Handles exporting playlists as CSV files
let PlaylistExporter = {
	// Parse an uploaded CSV file and return the data as a string
	async parseUploadedCSV(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			
			reader.onload = (e) => {
				try {
					const csvContent = e.target.result;
					
					// Basic validation
					if (!csvContent || csvContent.trim().length === 0) {
						reject(new Error('CSV file is empty'));
						return;
					}
					
					// Check for required headers
					const lines = csvContent.split('\n');
					if (lines.length < 2) {
						reject(new Error('CSV file must contain headers and at least one data row'));
						return;
					}
					
					const headers = lines[0].toLowerCase();
					const requiredHeaders = ['track name', 'artist name', 'album name'];
					const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
					
					if (missingHeaders.length > 0) {
						reject(new Error(`CSV missing required headers: ${missingHeaders.join(', ')}`));
						return;
					}
					
					console.log('CSV parsed successfully. Total lines:', lines.length - 1);
					resolve(csvContent);
				} catch (error) {
					reject(new Error('Failed to parse CSV: ' + error.message));
				}
			};
			
			reader.onerror = () => {
				reject(new Error('Failed to read file'));
			};
			
			reader.readAsText(file);
		});
	},

	// Analyze an uploaded CSV file
	async analyzeFromUpload(file) {
		const uploadStatus = document.getElementById('uploadStatus');
		
		try {
			// Show processing message
			if (uploadStatus) {
				uploadStatus.className = 'upload-status processing';
				uploadStatus.style.display = 'block';
				uploadStatus.textContent = 'Processing CSV file...';
			}
			
			// Parse the CSV
			const csvContent = await this.parseUploadedCSV(file);
			
			// Create a fake playlist object for the analysis
			const playlistName = file.name.replace('.csv', '').replace(/_/g, ' ');
			const fakePlaylist = {
				name: playlistName,
				external_urls: { spotify: '#' },
				images: [],
				owner: { id: 'Uploaded CSV' },
				tracks: { total: csvContent.split('\n').length - 1 }
			};
			
			// Open analysis window
			const analysisWindow = window.open('', '_blank');
			if (!analysisWindow) {
				throw new Error('Could not open analysis window. Please allow popups for this site.');
			}
			
			// Generate and write the HTML
			analysisWindow.document.write(this.generateAnalysisHTML(fakePlaylist, csvContent));
			analysisWindow.document.close();
			
			// Show success message
			if (uploadStatus) {
				uploadStatus.className = 'upload-status success';
				uploadStatus.textContent = '✓ CSV analyzed successfully! Analysis opened in new window.';
				setTimeout(() => {
					uploadStatus.style.display = 'none';
				}, 3000);
			}
			
		} catch (error) {
			console.error('Error analyzing uploaded CSV:', error);
			if (uploadStatus) {
				uploadStatus.className = 'upload-status error';
				uploadStatus.style.display = 'block';
				uploadStatus.textContent = '✗ ' + error.message;
			}
		}
	},

	// Take the access token string and playlist object, generate a csv from it, and when that data is resolved and
	// returned, save to a file.
	async export(playlist, row) {
		const exportBtn = document.getElementById("export"+row)
		if (exportBtn) exportBtn.textContent = 'Exporting...' // spinner on button
		try {
			let csv = await this.csvData(playlist)
			saveAs(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }), this.fileName(playlist) + ".csv")
		} catch (e) {
			error.innerHTML += "Couldn't export " + playlist.name + ". Encountered <tt>" + e + "</tt><br/>" + e.stack +
					'<br/>Please <a href="https://github.com/pavelkomarov/exportify/issues">let us know</a>.'
		} finally { // change back the export button's text
			const exportBtnReset = document.getElementById("export"+row)
			if (exportBtnReset) exportBtnReset.textContent = 'Export'
		}
	},

	// Analyze playlist data by opening it in a new tab (Simple mode - no audio features)
	async analyze(playlist, row) {
		const analyzeBtn = document.getElementById("analyze"+row)
		if (analyzeBtn) analyzeBtn.textContent = 'Analyzing...' // spinner on button
		try {
			let csv = await this.csvData(playlist)
			// Use simple analysis (without audio features)
			let html = this.generateSimpleAnalysisHTML(playlist, csv)
			let newWindow = window.open('', '_blank')
			newWindow.document.write(html)
			newWindow.document.close()
		} catch (e) {
			error.innerHTML += "Couldn't analyze " + playlist.name + ". Encountered <tt>" + e + "</tt><br/>" + e.stack +
					'<br/>Please <a href="https://github.com/pavelkomarov/exportify/issues">let us know</a>.'
		} finally { // change back the analyze button's text
			const analyzeBtnReset = document.getElementById("analyze"+row)
			if (analyzeBtnReset) analyzeBtnReset.textContent = 'Analyze'
		}
	},

	// Handles exporting all playlist data as a zip file
	async exportAll(playlists) {
		const exportAllBtn = document.getElementById("exportAll")
		if (exportAllBtn) exportAllBtn.textContent = 'Exporting...' // spinner on button
		error.innerHTML = ""
		let zip = new JSZip()

		for (let playlist of playlists) {
			try {
				let csv = await this.csvData(playlist)
				let fileName = this.fileName(playlist)
				while (zip.file(fileName + ".csv")) { fileName += "_" } // Add underscores if the file already exists so playlists with duplicate names don't overwrite each other.
				zip.file(fileName + ".csv", csv)
			} catch (e) { // Surface all errors
				error.innerHTML += "Couldn't export " + playlist.name + " with id " + playlist.id + ". Encountered <tt>" + e +
					"</tt><br>" + e.stack + '<br>Please <a href="https://github.com/pavelkomarov/exportify/issues">let us know</a>. ' +
					"The others are still being zipped.<br/>"
			}
		}
		const exportAllBtnReset = document.getElementById("exportAll")
		if (exportAllBtnReset) exportAllBtnReset.textContent = 'Export All' // change back button text
		saveAs(zip.generate({ type: "blob" }), "spotify_playlists.zip")
	},

	// take the playlist object and return an acceptable filename
	fileName(playlist) {
		return playlist.name.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_')// /.../g is a Perl-style modifier, g for global, meaning all matches replaced
	},

	// This is where the magic happens. The access token gives us permission to query this info from Spotify, and the
	// playlist object gives us all the information we need to start asking for songs.
	async csvData(playlist) {
		let increment = playlist.name == "Liked Songs" ? 50 : 100 // Can max call for only 50 tracks at a time vs 100 for playlists

		// Make asynchronous API calls for 100 songs at a time, and put the results (all Promises) in a list.
		let requests = []
		for (let offset = 0; offset < playlist.tracks.total; offset += increment) {
			requests.push(utils.apiCall(playlist.tracks.href + '?offset=' + offset + '&limit=' + increment, (offset/increment)*100)) // I'm spacing requests by 100ms regardless of increment.
		}
		// "returns a single Promise that resolves when all of the promises passed as an iterable have resolved"
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all
		let artist_ids = new Set()
		let album_ids = new Set()
		let data_promise = Promise.all(requests).then(responses => { // Gather all the data from the responses in a table.
			return responses.map(response => { // apply to all responses
				return response.items.map(song => { // apply to all songs in each response
					// Safety check! If there are artists/album listed and they have non-null identifier, add them to the sets
					song.track?.artists?.forEach(a => { if (a && a.id) { artist_ids.add(a.id) } })
					if (song.track?.album && song.track.album.id) { album_ids.add(song.track.album.id) }
					// Commas in various fields can throw off csv, so surround with quotes. Quotes are escaped by doubling "".
					// For robustness to missing data, null-checking question marks abound. Artists are separated with
					// semicolons so commas can be preserved in their names without confusion.
					return ['"'+song.track?.artists?.map(artist => { return artist?.id }).join(',')+'"', song.track?.album?.id, song.track?.uri,
						'"'+song.track?.name?.replace(/"/g,'""')+'"', '"'+song.track?.album?.name?.replace(/"/g,'""')+'"',
						'"'+song.track?.artists?.map(artist => { return artist?.name?.replace(/"/g,'""').replace(/;/g,'') }).join(';')+'"',
						song.track?.album?.release_date, song.track?.duration_ms, song.track?.popularity, song.track?.explicit, song.added_by?.id, song.added_at]
				})
			})
		})

		// Make queries on all the artists, because this json is where genre information lives. Unfortunately this
		// means a second wave of traffic, 50 artists at a time the maximum allowed.
		let genre_promise = data_promise.then(() => {
			artist_ids = Array.from(artist_ids) // Make groups of 50 artists, to all be queried together
			let artist_chunks = []; while (artist_ids.length) { artist_chunks.push(artist_ids.splice(0, 50)) }
			let artists_promises = artist_chunks.map((chunk_ids, i) => utils.apiCall(
				'https://api.spotify.com/v1/artists?ids='+chunk_ids.join(','), 100*i)) // volley of traffic, requests staggered by 100ms
			return Promise.all(artists_promises).then(responses => {
				let artist_genres = {} // build a dictionary, rather than a table
				responses.forEach(response => response.artists.forEach(
					artist => { if (artist) {artist_genres[artist.id] = artist.genres.join(',')} } )) // these are the artists who had ids before, but it's still possible they aren't in the genre database
				return artist_genres
			})
		})

		// Fetch album details, another wave of traffic, 20 albums at a time max. Happens after genre_promise has finished, to build in delay.
		let album_promise = Promise.all([data_promise, genre_promise]).then(() => {
			album_ids = Array.from(album_ids) // chunk set of ids into 20s
			let album_chunks = []; while (album_ids.length) { album_chunks.push(album_ids.splice(0, 20)) }
			let album_promises = album_chunks.map((chunk_ids, i) => utils.apiCall(
				'https://api.spotify.com/v1/albums?ids=' + chunk_ids.join(','), 120*i))
			return Promise.all(album_promises).then(responses => {
				let record_labels = {} // analogous to genres
				responses.forEach(response => response.albums.forEach(
					album => { if (album) { record_labels[album.id] = album.label } } ))
				return record_labels
			})
		})

		// Make queries for song audio features, 100 songs at a time.
		let features_promise = Promise.all([data_promise, genre_promise, album_promise]).then(values => {
			let data = values[0]
			console.log('Starting audio features fetch for', data.flat().length, 'tracks');
			let songs_promises = data.map((chunk, i) => { // remember data is an array of arrays, each subarray 100 tracks
				// Extract track IDs from the URI (format: spotify:track:ID)
				let ids = chunk.map(song => {
					if (!song || !song[2]) {
						console.warn('Missing track URI in song data:', song);
						return null;
					}
					let uri = song[2];
					// Handle both quoted and unquoted URIs
					let cleanUri = uri.replace(/^["']|["']$/g, '');
					let trackId = cleanUri.split(':')[2];
					if (!trackId) {
						console.warn('Could not extract track ID from URI:', cleanUri);
					}
					return trackId;
				}).filter(id => id).join(',');
				
				if (!ids) {
					console.warn('No track IDs found for audio features request in chunk', i);
					return Promise.resolve({ audio_features: chunk.map(() => null) });
				}
				
				console.log(`Fetching audio features for chunk ${i}, ${ids.split(',').length} tracks`);
				let apiUrl = 'https://api.spotify.com/v1/audio-features?ids=' + ids;
				
				return utils.apiCall(apiUrl, 100*i).then(response => {
					console.log(`Audio features response for chunk ${i}:`, response);
					if (!response || !response.audio_features) {
						console.error('Invalid response structure for chunk', i, ':', response);
						return { audio_features: chunk.map(() => null) };
					}
					return response;
				}).catch(error => {
					console.error('Error fetching audio features for chunk', i, ':', error);
					// Return null features array if API call fails
					return { audio_features: chunk.map(() => null) };
				});
			})
			return Promise.all(songs_promises).then(responses => {
				console.log('All audio features responses received:', responses);
				return responses.map((response, chunkIndex) => { // for each response
					if (!response || !response.audio_features) {
						console.warn('No audio_features in response for chunk', chunkIndex, 'Response:', response);
						// Return empty arrays for each track in this chunk
						return data[chunkIndex]?.map(() => [null, null, null, null, null, null, null, null, null, null, null, null]) || [];
					}
					return response.audio_features.map((feats, featIndex) => {
						if (!feats) {
							console.warn(`Track ${featIndex} in chunk ${chunkIndex} has no audio features (null from Spotify)`);
							// Track has no audio features (null response from Spotify)
							return [null, null, null, null, null, null, null, null, null, null, null, null];
						}
						let features = [
							feats?.danceability ?? null, 
							feats?.energy ?? null, 
							feats?.key ?? null, 
							feats?.loudness ?? null, 
							feats?.mode ?? null,
							feats?.speechiness ?? null, 
							feats?.acousticness ?? null, 
							feats?.instrumentalness ?? null, 
							feats?.liveness ?? null, 
							feats?.valence ?? null,
							feats?.tempo ?? null, 
							feats?.time_signature ?? null
						];
						if (featIndex === 0 && chunkIndex === 0) {
							console.log('Sample audio features extracted:', features, 'from:', feats);
						}
						return features;
					})
				})
			})
		})

		// join the tables, label the columns, and put all data in a single csv string
		return Promise.all([data_promise, genre_promise, album_promise, features_promise]).then(values => {
			let [data, artist_genres, record_labels, features] = values
			data = data.flat() // get rid of the batch dimension (only 100 songs per call)
			features = features.flat() // get rid of the batch dimension (only 100 songs per call)
			
			console.log('Combining data. Total tracks:', data.length, 'Total feature arrays:', features.length);
			if (features.length > 0 && features[0]) {
				console.log('Sample feature array:', features[0]);
			}
			
			data.forEach((row, i) => {
				// add genres
				let artist_ids = row.shift()?.slice(1, -1).split(',') // strip the quotes from artist ids, and toss; user doesn't need to see ids
				let deduplicated_genres = new Set(artist_ids?.map(a => artist_genres[a]).join(",").split(",")) // in case multiple artists
				row.push('"'+Array.from(deduplicated_genres).filter(x => x != "").join(",")+'"') // remove empty strings
				// add album details
				let album_id = row.shift()
				row.push('"'+record_labels[album_id]+'"')
				
				// add features - MUST be done after shift() operations to maintain correct index
				if (!features || features.length === 0) {
					console.warn(`No audio features data available for track ${i}. Adding empty values.`);
					for (let j = 0; j < 12; j++) row.push(''); // 12 audio feature fields
				} else if (features[i] && Array.isArray(features[i]) && features[i].length === 12) {
					features[i].forEach(feat => row.push(feat !== null && feat !== undefined ? feat : '')); // Use empty string for null values
				} else {
					console.warn(`Track ${i} has invalid features array:`, features[i]);
					// No features for this track, add empty values
					for (let j = 0; j < 12; j++) row.push('');
				}
			})
			// make a string
			let csv = "Track URI,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms),Popularity,Explicit,Added By,Added At,Genres,Record Label,Danceability,Energy,Key,Loudness,Mode,Speechiness,Acousticness,Instrumentalness,Liveness,Valence,Tempo,Time Signature\n"
			data.forEach(row => { csv += row.join(",") + "\n" })
			return csv
		})
	},

	// Generate HTML for simple analysis (without audio features)
	generateSimpleAnalysisHTML(playlist, csv) {
		const lines = csv.split('\n');
		const headers = lines[0].split(',');
		const data = lines.slice(1).filter(line => line.trim());
		
		// Helper function to escape HTML
		const escapeHtml = (text) => {
			if (!text) return '';
			return String(text).replace(/[&<>"']/g, (match) => {
				const escape = {
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#39;'
				};
				return escape[match];
			});
		};
		
		// Parse CSV row handling quoted fields
		const parseCSVRow = (row) => {
			const result = [];
			let current = '';
			let inQuotes = false;
			
			for (let i = 0; i < row.length; i++) {
				const char = row[i];
				if (char === '"') {
					inQuotes = !inQuotes;
				} else if (char === ',' && !inQuotes) {
					result.push(current.trim());
					current = '';
				} else {
					current += char;
				}
			}
			result.push(current.trim());
			return result;
		};
		
		// Get column indices
		const getColumnIndex = (name) => {
			return headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
		};
		
		const trackNameIdx = getColumnIndex('Track Name');
		const artistIdx = getColumnIndex('Artist Name');
		const albumIdx = getColumnIndex('Album Name');
		const releaseDateIdx = getColumnIndex('Release Date');
		const popularityIdx = getColumnIndex('Popularity');
		const durationIdx = getColumnIndex('Duration');
		const genresIdx = getColumnIndex('Genres');
		const explicitIdx = getColumnIndex('Explicit');
		const addedAtIdx = getColumnIndex('Added At');
		
		// Process data
		const processedData = data.map(row => {
			const fields = parseCSVRow(row);
			return {
				trackName: fields[trackNameIdx]?.replace(/^"|"$/g, ''),
				artist: fields[artistIdx]?.replace(/^"|"$/g, ''),
				album: fields[albumIdx]?.replace(/^"|"$/g, ''),
				releaseDate: fields[releaseDateIdx]?.replace(/^"|"$/g, ''),
				popularity: parseInt(fields[popularityIdx]) || 0,
				duration: parseInt(fields[durationIdx]) || 0,
				genres: fields[genresIdx]?.replace(/^"|"$/g, '').split(',').filter(g => g.trim()),
				explicit: fields[explicitIdx]?.toLowerCase() === 'true',
				addedAt: fields[addedAtIdx]?.replace(/^"|"$/g, '')
			};
		}).filter(row => row.trackName);
		
		const totalTracks = processedData.length;
		const avgPopularity = processedData.reduce((sum, t) => sum + t.popularity, 0) / totalTracks;
		const totalDuration = processedData.reduce((sum, t) => sum + t.duration, 0);
		const explicitCount = processedData.filter(t => t.explicit).length;
		
		// Genre analysis
		const genreCount = {};
		processedData.forEach(track => {
			track.genres.forEach(genre => {
				if (genre) genreCount[genre] = (genreCount[genre] || 0) + 1;
			});
		});
		const topGenres = Object.entries(genreCount)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);
		
		// Artist analysis
		const artistCount = {};
		processedData.forEach(track => {
			if (track.artist) artistCount[track.artist] = (artistCount[track.artist] || 0) + 1;
		});
		const topArtists = Object.entries(artistCount)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);
		
		// Year analysis
		const yearCount = {};
		processedData.forEach(track => {
			if (track.releaseDate) {
				const year = track.releaseDate.substring(0, 4);
				yearCount[year] = (yearCount[year] || 0) + 1;
			}
		});
		const yearData = Object.entries(yearCount).sort((a, b) => a[0] - b[0]);
		
		const coverArtUrl = playlist.images && playlist.images.length > 0 
			? playlist.images[0].url 
			: 'https://placehold.co/300x300?text=No+Image';
		
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(playlist.name)} - Simple Analysis</title>
	<link rel="stylesheet" href="styles/artistic-theme.css">
	<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
	<style>
		body {
			background: var(--bg-primary);
			color: var(--text-primary);
			font-family: 'Inter', sans-serif;
			margin: 0;
			padding: 0;
			min-height: 100vh;
		}
		.page-container {
			max-width: 1400px;
			margin: 0 auto;
			padding: 0 var(--space-xl);
			position: relative;
			z-index: 2;
		}
		.simple-badge {
			display: inline-block;
			padding: var(--space-xs) var(--space-sm);
			background: var(--gradient-primary);
			border-radius: var(--radius-full);
			font-size: var(--text-xs);
			font-weight: var(--font-weight-bold);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-bottom: var(--space-md);
		}
		.info-note {
			background: rgba(0, 212, 255, 0.1);
			border-left: 3px solid var(--accent-blue);
			padding: var(--space-md);
			border-radius: var(--radius-sm);
			margin: var(--space-lg) 0;
			font-size: var(--text-sm);
		}
	</style>
</head>
<body>
	<div style="max-width: 1400px; margin: 0 auto; padding: 0 var(--space-xl);">
		<div class="header">
			<img src="${coverArtUrl}" alt="Playlist Cover" class="playlist-cover" onerror="this.src='https://placehold.co/300x300?text=No+Image'" />
			<div class="header-content">
				<div class="simple-badge">Simple Analysis</div>
				<h1>${escapeHtml(playlist.name)}</h1>
				<p>Basic Playlist Insights</p>
			</div>
		</div>
		
		<div class="info-note">
			<strong>ℹ️ Simple Analysis Mode:</strong> This shows basic playlist data without audio features (danceability, energy, tempo, etc.). 
			For complete analysis with all audio characteristics, export from <a href="https://exportify.net" target="_blank" style="color: var(--accent-blue);">exportify.net</a> and upload the CSV.
		</div>
		
		<div class="summary-section" style="padding: 40px 0;">
			<div class="stat-cards">
				<div class="stat-card">
					<div class="stat-card-value">${totalTracks}</div>
					<div class="stat-card-label">Total Tracks</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${avgPopularity.toFixed(0)}</div>
					<div class="stat-card-label">Avg Popularity</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${Math.floor(totalDuration / 60000)} min</div>
					<div class="stat-card-label">Total Duration</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${explicitCount}</div>
					<div class="stat-card-label">Explicit Tracks</div>
				</div>
			</div>
		</div>
		
		<section id="top-songs" class="viz-section">
			<h2 class="section-header">Top 10 by Song Count</h2>
			<div class="lists-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px;">
				<div class="track-list">
					<div class="track-list-title">Top 10 Artists</div>
					<div id="topArtistsList"></div>
				</div>
				<div class="track-list">
					<div class="track-list-title">Top 10 Genres</div>
					<div id="topGenresList"></div>
				</div>
			</div>
		</section>
		
		<section id="artist-genre" class="viz-section">
			<h2 class="section-header">Artist & Genre Insights</h2>
			<div class="chart-grid">
				<div class="chart-container">
					<div class="chart-title">Genre Distribution</div>
					<div id="genreChart" class="chart-wrapper"></div>
				</div>
				<div class="chart-container">
					<div class="chart-title">Top Artists</div>
					<div id="artistChart" class="chart-wrapper"></div>
				</div>
			</div>
		</section>
		
		<section id="playlist-characteristics" class="viz-section">
			<h2 class="section-header">Playlist Characteristics</h2>
			<div class="chart-grid">
				<div class="chart-container">
					<div class="chart-title">Popularity Distribution</div>
					<div id="popularityChart" class="chart-wrapper"></div>
				</div>
				<div class="chart-container">
					<div class="chart-title">Explicit Content</div>
					<div id="explicitChart" class="chart-wrapper"></div>
				</div>
			</div>
		</section>
		
		<section id="temporal-analysis" class="viz-section">
			<h2 class="section-header">Temporal Analysis</h2>
			<div class="chart-grid">
				<div class="chart-container" style="grid-column: 1 / -1;">
					<div class="chart-title">Release Timeline</div>
					<div id="yearChart" class="chart-wrapper"></div>
				</div>
			</div>
		</section>
		
		<section id="track-data" class="viz-section">
			<h2 class="section-header">Complete Track Data</h2>
			<div id="trackTable"></div>
		</section>
	</div>
	
	<footer class="main-footer" style="background: var(--bg-elevated); border-top: 1px solid rgba(255, 255, 255, 0.05); padding: var(--space-xl) 0; margin-top: var(--space-4xl);">
		<div class="footer-content" style="max-width: 1400px; margin: 0 auto; padding: 0 var(--space-xl); text-align: center;">
			<p class="footer-text" style="font-size: var(--text-base); color: var(--text-secondary); margin-bottom: var(--space-sm); display: flex; align-items: center; justify-content: center; gap: var(--space-sm); flex-wrap: wrap;">
				<span style="color: var(--text-primary); font-weight: var(--font-weight-semibold);">Nexporify - Open Source Music Analytics</span>
				<a href="https://github.com/visheshvs/exportify" target="_blank" rel="noopener" style="color: var(--accent-primary); text-decoration: none; transition: color 0.3s ease;">View on GitHub</a>
			</p>
			<p class="footer-credit" style="font-size: var(--text-sm); color: var(--text-tertiary);">
				Based on original work by <a href="https://github.com/pavelkomarov/exportify" target="_blank" rel="noopener" style="color: var(--accent-primary); text-decoration: none; transition: color 0.3s ease;">pavelkomarov/exportify</a>
			</p>
		</div>
	</footer>
	
	<script>
		const processedData = ${JSON.stringify(processedData)};
		const topGenres = ${JSON.stringify(topGenres)};
		const topArtists = ${JSON.stringify(topArtists)};
		const yearData = ${JSON.stringify(yearData)};
		
		// Top Artists List
		const topArtistsList = document.getElementById('topArtistsList');
		if (topArtistsList) {
			topArtistsList.innerHTML = topArtists.map(([artist, count], i) => 
				'<div class="track-list-item"><span>' + (i + 1) + '. ' + artist + '</span><span>' + count + ' tracks</span></div>'
			).join('');
		}
		
		// Top Genres List
		const topGenresList = document.getElementById('topGenresList');
		if (topGenresList) {
			topGenresList.innerHTML = topGenres.map(([genre, count], i) => 
				'<div class="track-list-item"><span>' + (i + 1) + '. ' + genre + '</span><span>' + count + ' tracks</span></div>'
			).join('');
		}
		
		// Genre Chart
		new ApexCharts(document.querySelector("#genreChart"), {
			series: [{
				data: topGenres.map(([genre, count]) => count)
			}],
			chart: { type: 'bar', height: 400, background: 'transparent', toolbar: { show: false } },
			plotOptions: { bar: { horizontal: true, distributed: true } },
			colors: ['#1DB954', '#1ed760', '#00d9ff', '#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'],
			xaxis: { categories: topGenres.map(([genre]) => genre), labels: { style: { colors: '#FFFFFF' } } },
			yaxis: { labels: { style: { colors: '#FFFFFF' } } },
			tooltip: { theme: 'dark' },
			legend: { show: false }
		}).render();
		
		// Artist Chart
		new ApexCharts(document.querySelector("#artistChart"), {
			series: [{
				data: topArtists.map(([artist, count]) => count)
			}],
			chart: { type: 'bar', height: 400, background: 'transparent', toolbar: { show: false } },
			plotOptions: { bar: { horizontal: true, distributed: true } },
			colors: ['#1DB954', '#1ed760', '#00d9ff', '#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'],
			xaxis: { categories: topArtists.map(([artist]) => artist), labels: { style: { colors: '#FFFFFF' } } },
			yaxis: { labels: { style: { colors: '#FFFFFF' } } },
			tooltip: { theme: 'dark' },
			legend: { show: false }
		}).render();
		
		// Popularity Distribution
		const popularityBuckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
		processedData.forEach(track => {
			const pop = track.popularity;
			if (pop <= 20) popularityBuckets['0-20']++;
			else if (pop <= 40) popularityBuckets['21-40']++;
			else if (pop <= 60) popularityBuckets['41-60']++;
			else if (pop <= 80) popularityBuckets['61-80']++;
			else popularityBuckets['81-100']++;
		});
		
		new ApexCharts(document.querySelector("#popularityChart"), {
			series: [{ name: 'Tracks', data: Object.values(popularityBuckets) }],
			chart: { type: 'bar', height: 350, background: 'transparent', toolbar: { show: false } },
			colors: ['#1DB954'],
			xaxis: { categories: Object.keys(popularityBuckets), labels: { style: { colors: '#FFFFFF' } } },
			yaxis: { labels: { style: { colors: '#FFFFFF' } } },
			tooltip: { theme: 'dark' },
			grid: { borderColor: 'rgba(255, 255, 255, 0.1)' }
		}).render();
		
		// Explicit Content Chart
		const explicitCount = processedData.filter(t => t.explicit).length;
		const cleanCount = processedData.length - explicitCount;
		
		new ApexCharts(document.querySelector("#explicitChart"), {
			series: [explicitCount, cleanCount],
			chart: { type: 'donut', height: 350, background: 'transparent' },
			labels: ['Explicit', 'Clean'],
			colors: ['#ff6b6b', '#1DB954'],
			legend: { labels: { colors: '#FFFFFF' } },
			tooltip: { theme: 'dark' },
			plotOptions: {
				pie: {
					donut: {
						labels: {
							show: true,
							total: {
								show: true,
								label: 'Total',
								color: '#FFFFFF'
							}
						}
					}
				}
			}
		}).render();
		
		// Year Chart
		new ApexCharts(document.querySelector("#yearChart"), {
			series: [{ name: 'Tracks', data: yearData.map(([year, count]) => count) }],
			chart: { type: 'area', height: 350, background: 'transparent', toolbar: { show: false } },
			stroke: { curve: 'smooth', width: 3, colors: ['#1DB954'] },
			fill: {
				type: 'gradient',
				gradient: {
					shade: 'dark',
					type: 'vertical',
					shadeIntensity: 0.5,
					gradientToColors: ['#00d4ff'],
					opacityFrom: 0.7,
					opacityTo: 0.1
				}
			},
			xaxis: { categories: yearData.map(([year]) => year), labels: { style: { colors: '#FFFFFF' } } },
			yaxis: { labels: { style: { colors: '#FFFFFF' } } },
			tooltip: { theme: 'dark' },
			grid: { borderColor: 'rgba(255, 255, 255, 0.1)' }
		}).render();
		
		// Track Table
		const trackTable = document.getElementById('trackTable');
		if (trackTable) {
			let tableHTML = '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse;">';
			tableHTML += '<thead><tr style="border-bottom: 2px solid var(--accent-primary);">';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">#</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Track</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Artist</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Album</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Release</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Duration</th>';
			tableHTML += '<th style="padding: 16px; text-align: left; color: var(--text-primary); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Popularity</th>';
			tableHTML += '</tr></thead><tbody>';
			
			processedData.forEach((track, i) => {
				const duration = Math.floor(track.duration / 60000) + ':' + String(Math.floor((track.duration % 60000) / 1000)).padStart(2, '0');
				tableHTML += '<tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.2s ease;" onmouseover="this.style.background=\\'rgba(29, 185, 84, 0.1)\\'" onmouseout="this.style.background=\\'transparent\\'">';
				tableHTML += '<td style="padding: 14px; color: var(--text-tertiary);">' + (i + 1) + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-primary); font-weight: 600;">' + (track.trackName || '-') + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-secondary);">' + (track.artist || '-') + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-secondary);">' + (track.album || '-') + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-secondary);">' + (track.releaseDate || '-') + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-secondary);">' + duration + '</td>';
				tableHTML += '<td style="padding: 14px; color: var(--text-secondary);">' + track.popularity + '</td>';
				tableHTML += '</tr>';
			});
			
			tableHTML += '</tbody></table></div>';
			trackTable.innerHTML = tableHTML;
		}
	</script>
</body>
</html>`;
	},
	
	// Generate HTML for full analysis page (with audio features)
	generateAnalysisHTML(playlist, csv) {
		// Parse CSV into rows
		let lines = csv.trim().split('\n')
		let headers = lines[0].split(',')
		let rows = lines.slice(1).map(line => {
			// Handle CSV parsing with quoted fields
			let result = []
			let current = ''
			let inQuotes = false
			for (let i = 0; i < line.length; i++) {
				let char = line[i]
				if (char === '"') {
					if (inQuotes && line[i + 1] === '"') {
						current += '"'
						i++ // skip next quote
					} else {
						inQuotes = !inQuotes
					}
				} else if (char === ',' && !inQuotes) {
					result.push(current)
					current = ''
				} else {
					current += char
				}
			}
			result.push(current) // push last field
			return result
		})

		// Format duration from ms to mm:ss
		let formatDuration = (ms) => {
			if (!ms) return ''
			let seconds = Math.floor(ms / 1000)
			let minutes = Math.floor(seconds / 60)
			seconds = seconds % 60
			return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
		}

		// Format date to just year if available
		let formatDate = (dateStr) => {
			if (!dateStr) return ''
			return dateStr.split('-')[0] // just the year
		}

		// Clean up field values (remove quotes)
		let cleanValue = (val) => {
			if (!val) return ''
			return val.toString().replace(/^"|"$/g, '').trim()
		}

		// Prepare data for JavaScript (raw values for sorting/filtering)
		let rawData = rows.map(row => row.map(cell => cleanValue(cell)))

		// Build table rows HTML
		let tableRows = rows.map(row => {
			let cells = row.map((cell, idx) => {
				let value = cleanValue(cell)
				// Format specific columns
				if (headers[idx] === 'Duration (ms)') {
					value = formatDuration(parseInt(value) || 0)
				} else if (headers[idx] === 'Release Date') {
					value = formatDate(value)
				} else if (headers[idx] === 'Explicit') {
					value = value === 'true' ? '✓' : ''
				} else if (headers[idx] === 'Popularity') {
					value = value || '0'
				}
				return `<td>${this.escapeHtml(value)}</td>`
			}).join('')
			return `<tr>${cells}</tr>`
		}).join('')

		// Build table headers HTML with sorting capability
		let tableHeaders = headers.map((header, idx) => {
			// Shorten some header names for better display
			let displayHeader = header
			if (header === 'Duration (ms)') displayHeader = 'Duration'
			if (header === 'Added By') displayHeader = 'Added By'
			if (header === 'Added At') displayHeader = 'Added'
			return `<th class="sortable" data-column="${idx}" data-sort="none">
				${this.escapeHtml(displayHeader)}
				<span class="sort-indicator">↕</span>
			</th>`
		}).join('')

		// Build filter row HTML
		let filterRow = headers.map((header, idx) => {
			return `<td><input type="text" class="filter-input" data-column="${idx}" placeholder="Filter..." /></td>`
		}).join('')

		// Get playlist cover art URL
		let coverArtUrl = playlist.images && playlist.images.length > 0 
			? playlist.images[0].url 
			: 'https://placehold.co/300x300?text=No+Image'
		
		// Calculate statistics
		let uniqueArtists = new Set()
		let uniqueAlbums = new Set()
		let uniqueGenres = new Set()
		rows.forEach(row => {
			// Artists
			let artistStr = cleanValue(row[headers.indexOf('Artist Name(s)')])
			if (artistStr) {
				artistStr.split(';').forEach(a => {
					let artist = a.trim()
					if (artist) uniqueArtists.add(artist)
				})
			}
			// Albums
			let album = cleanValue(row[headers.indexOf('Album Name')])
			if (album) uniqueAlbums.add(album)
			// Genres
			let genreStr = cleanValue(row[headers.indexOf('Genres')])
			if (genreStr) {
				genreStr.split(',').forEach(g => {
					let genre = g.trim()
					if (genre) uniqueGenres.add(genre)
				})
			}
		})

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${this.escapeHtml(playlist.name)} - Analysis | Nexporify</title>
	<script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap');
		:root {
			--bg-primary: #0a0a0a;
			--bg-secondary: #121212;
			--bg-elevated: #1a1a1a;
			--accent-primary: #1DB954;
			--accent-blue: #00D4FF;
			--accent-magenta: #FF00E5;
			--text-primary: #FFFFFF;
			--text-secondary: rgba(255, 255, 255, 0.7);
			--text-tertiary: rgba(255, 255, 255, 0.5);
		}
		body {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: var(--bg-primary);
			background-image: linear-gradient(180deg, #0a0a0a 0%, #121212 50%, #1a1a1a 100%);
			padding: 0;
			color: var(--text-primary);
			overflow-x: hidden;
			-webkit-font-smoothing: antialiased;
		}
		body::before {
			content: '';
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E");
			pointer-events: none;
			z-index: 1;
		}
		.page-container {
			max-width: 1400px;
			margin: 0 auto;
			padding: 0 var(--space-xl);
			position: relative;
			z-index: 2;
		}
		.header {
			background: linear-gradient(135deg, rgba(29, 185, 84, 0.2) 0%, rgba(0, 212, 255, 0.15) 100%);
			backdrop-filter: blur(20px);
			border-bottom: 1px solid rgba(255, 255, 255, 0.1);
			color: var(--text-primary);
			padding: 80px 40px 60px;
			text-align: center;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 40px;
			position: relative;
			overflow: hidden;
		}
		.header::before {
			content: '';
			position: absolute;
			width: 500px;
			height: 500px;
			background: radial-gradient(circle, rgba(29, 185, 84, 0.1) 0%, transparent 70%);
			top: -250px;
			right: -250px;
			border-radius: 50%;
			filter: blur(60px);
		}
		.playlist-cover {
			width: 280px;
			height: 280px;
			border-radius: 20px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(29, 185, 84, 0.3);
			object-fit: cover;
			transition: transform 0.5s ease, box-shadow 0.5s ease;
		}
		.playlist-cover:hover {
			transform: scale(1.05);
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 60px rgba(29, 185, 84, 0.5);
		}
		.header-content {
			flex: 1;
			position: relative;
			z-index: 2;
		}
		.header h1 {
			font-size: clamp(32px, 5vw, 64px);
			font-weight: 900;
			margin-bottom: 10px;
			letter-spacing: -0.03em;
			background: linear-gradient(135deg, #1DB954 0%, #00D4FF 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
		}
		.header p {
			opacity: 0.8;
			font-size: 18px;
			color: var(--text-secondary);
			font-weight: 500;
		}
		.table-wrapper {
			overflow-x: auto;
			max-height: calc(100vh - 200px);
		}
		.table-wrapper {
			background: var(--bg-elevated);
			border-radius: 20px;
			padding: 20px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
			border: 1px solid rgba(255, 255, 255, 0.05);
			overflow-x: auto;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 14px;
		}
		thead {
			background: rgba(29, 185, 84, 0.1);
			position: sticky;
			top: 0;
			z-index: 10;
		}
		th {
			padding: 16px 12px;
			text-align: left;
			font-weight: 700;
			color: var(--text-primary);
			border-bottom: 2px solid var(--accent-primary);
			font-size: 12px;
			text-transform: uppercase;
			letter-spacing: 0.1em;
			position: relative;
		}
		th.sortable {
			cursor: pointer;
			user-select: none;
			transition: background 0.2s ease;
		}
		th.sortable:hover {
			background: rgba(29, 185, 84, 0.2);
		}
		.sort-indicator {
			margin-left: 5px;
			font-size: 10px;
			opacity: 0.5;
		}
		th[data-sort="asc"] .sort-indicator::after {
			content: " ↑";
			opacity: 1;
		}
		th[data-sort="desc"] .sort-indicator::after {
			content: " ↓";
			opacity: 1;
		}
		.filter-input {
			width: 100%;
			padding: 10px 12px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			border-radius: 8px;
			font-size: 13px;
			background: var(--bg-secondary);
			color: var(--text-primary);
			transition: all 0.2s ease;
		}
		.filter-input:focus {
			outline: none;
			border-color: var(--accent-primary);
			box-shadow: 0 0 0 3px rgba(29, 185, 84, 0.2);
			background: var(--bg-elevated);
		}
		.filter-row {
			background: rgba(0, 0, 0, 0.2);
		}
		td {
			padding: 14px 12px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
			white-space: nowrap;
			color: var(--text-secondary);
		}
		tbody tr {
			transition: background 0.2s ease;
		}
		tbody tr:hover {
			background: rgba(29, 185, 84, 0.1);
		}
		tbody tr:last-child td {
			border-bottom: none;
		}
		.track-name {
			font-weight: 500;
			color: #1DB954;
		}
		.artist-name {
			color: #666;
		}
		.stats {
			display: flex;
			justify-content: center;
			gap: 30px;
			padding: 20px;
			background: #f8f9fa;
			border-top: 1px solid #dee2e6;
		}
		.stat-item {
			text-align: center;
		}
		.stat-value {
			font-size: 24px;
			font-weight: 600;
			color: #1DB954;
		}
		.stat-label {
			font-size: 12px;
			color: #666;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			margin-top: 5px;
		}
		.visualizations {
			padding: 60px 0;
			background: transparent;
		}
		.viz-section {
			margin-bottom: 120px;
			opacity: 0;
			transform: translateY(30px);
			transition: opacity 0.8s ease, transform 0.8s ease;
		}
		.viz-section.visible {
			opacity: 1;
			transform: translateY(0);
		}
		.section-header {
			font-size: clamp(28px, 4vw, 48px);
			font-weight: 900;
			color: var(--text-primary);
			margin-bottom: 60px;
			padding-bottom: 20px;
			border-bottom: 2px solid var(--accent-primary);
			display: flex;
			align-items: center;
			gap: 20px;
			letter-spacing: -0.02em;
			position: relative;
		}
		.section-header::after {
			content: '';
			position: absolute;
			bottom: -2px;
			left: 0;
			width: 100px;
			height: 2px;
			background: linear-gradient(90deg, var(--accent-primary), transparent);
		}
		.section-header::before {
			content: "";
		}
		.chart-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
			gap: 25px;
			margin-bottom: 30px;
		}
		.chart-container {
			background: var(--bg-elevated);
			border-radius: 20px;
			padding: 30px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
			border: 1px solid rgba(255, 255, 255, 0.05);
			transition: transform 0.3s ease, box-shadow 0.3s ease;
			position: relative;
			overflow: hidden;
		}
		.chart-container::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: linear-gradient(135deg, rgba(29, 185, 84, 0.05) 0%, rgba(0, 212, 255, 0.05) 100%);
			opacity: 0;
			transition: opacity 0.3s ease;
			pointer-events: none;
		}
		.chart-container:hover {
			transform: translateY(-4px);
			box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 0 30px rgba(29, 185, 84, 0.2);
		}
		.chart-container:hover::before {
			opacity: 1;
		}
		.chart-title {
			font-size: 18px;
			font-weight: 700;
			margin-bottom: 20px;
			color: var(--text-primary);
			letter-spacing: -0.01em;
		}
		.chart-wrapper {
			min-height: 300px;
		}
		.stat-cards {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 15px;
			margin-bottom: 30px;
		}
		.stat-card {
			background: var(--bg-elevated);
			border-radius: 16px;
			padding: 30px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
			border: 1px solid rgba(255, 255, 255, 0.05);
			text-align: center;
			transition: transform 0.3s ease, box-shadow 0.3s ease;
			position: relative;
			overflow: hidden;
		}
		.stat-card::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: linear-gradient(135deg, rgba(29, 185, 84, 0.1) 0%, rgba(0, 212, 255, 0.1) 100%);
			opacity: 0;
			transition: opacity 0.3s ease;
		}
		.stat-card:hover {
			transform: translateY(-4px);
			box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 0 30px rgba(29, 185, 84, 0.3);
		}
		.stat-card:hover::before {
			opacity: 1;
		}
		.stat-card-value {
			font-size: clamp(32px, 4vw, 48px);
			font-weight: 900;
			background: linear-gradient(135deg, #1DB954 0%, #00D4FF 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
			margin-bottom: 8px;
			position: relative;
			z-index: 1;
		}
		.stat-card-label {
			font-size: 12px;
			color: var(--text-tertiary);
			text-transform: uppercase;
			letter-spacing: 0.1em;
			font-weight: 600;
			position: relative;
			z-index: 1;
		}
		.summary-section {
			padding: 60px 40px;
			background: transparent;
		}
		.export-buttons {
			display: flex;
			gap: 15px;
			justify-content: center;
			margin-top: 20px;
		}
		.export-btn {
			padding: var(--space-md) var(--space-xl);
			border: 2px solid var(--accent-primary);
			border-radius: var(--radius-full);
			font-size: var(--text-base);
			font-weight: var(--font-weight-semibold);
			cursor: pointer;
			transition: all var(--transition-base);
			display: inline-flex;
			align-items: center;
			gap: var(--space-sm);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			position: relative;
			overflow: hidden;
			background: transparent;
			color: var(--text-primary);
		}
		.export-btn::before {
			content: '';
			position: absolute;
			top: 0;
			left: -100%;
			width: 100%;
			height: 100%;
			background: var(--gradient-primary);
			transition: left var(--transition-base);
			z-index: -1;
		}
		.export-btn:hover {
			border-color: var(--accent-primary-light);
			box-shadow: var(--glow-primary);
			transform: translateY(-2px);
		}
		.export-btn:hover::before {
			left: 0;
		}
		.export-btn-csv {
			border-color: var(--accent-primary);
		}
		.export-btn-csv::before {
			background: var(--gradient-primary);
		}
		.export-btn-json {
			border-color: var(--accent-blue);
		}
		.export-btn-json::before {
			background: linear-gradient(135deg, var(--accent-blue) 0%, #0099cc 100%);
		}
		.export-btn-json:hover {
			box-shadow: 0 0 20px rgba(0, 212, 255, 0.4);
		}
		.track-list {
			background: var(--bg-elevated);
			border-radius: 20px;
			padding: 30px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
			border: 1px solid rgba(255, 255, 255, 0.05);
		}
		.track-list-title {
			font-size: 18px;
			font-weight: 700;
			margin-bottom: 20px;
			color: var(--text-primary);
			letter-spacing: -0.01em;
		}
		.track-list-item {
			padding: 16px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.05);
			display: flex;
			justify-content: space-between;
			align-items: center;
			transition: background 0.2s ease, transform 0.2s ease;
			border-radius: 8px;
			margin-bottom: 4px;
		}
		.track-list-item:last-child {
			border-bottom: none;
			margin-bottom: 0;
		}
		.track-list-item:hover {
			background: rgba(29, 185, 84, 0.1);
			transform: translateX(4px);
		}
		.track-info {
			flex: 1;
		}
		.track-name-link {
			font-weight: 600;
			color: var(--accent-primary);
			text-decoration: none;
			transition: color 0.2s ease;
		}
		.track-name-link:hover {
			color: var(--accent-blue);
		}
		.track-artist {
			font-size: 14px;
			color: var(--text-tertiary);
			margin-top: 4px;
		}
		.track-score {
			font-weight: 700;
			color: var(--text-primary);
			font-size: 16px;
		}
		.lists-container {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 25px;
		}
		.word-cloud {
			background: white;
			border-radius: 8px;
			padding: 20px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			align-items: center;
			justify-content: center;
			min-height: 200px;
		}
		.word-cloud-item {
			padding: 8px 12px;
			background: #1DB954;
			color: white;
			border-radius: 20px;
			font-weight: 500;
			display: inline-block;
		}
		@media (max-width: 768px) {
			.header {
				padding: 60px 20px 40px;
			}
			.visualizations {
				padding: 60px 20px;
			}
			.chart-grid {
				grid-template-columns: 1fr;
				gap: 30px;
			}
			.chart-container {
				padding: 20px;
			}
			.summary-section {
				padding: 40px 20px;
			}
			.lists-container {
				grid-template-columns: 1fr;
			}
			.stat-cards {
				grid-template-columns: repeat(2, 1fr);
				gap: 15px;
			}
			.table-wrapper {
				padding: 15px;
			}
		}
	</style>
</head>
<body>
	<div style="max-width: 1400px; margin: 0 auto; padding: 0 var(--space-xl);">
		<div class="header" style="padding: 60px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
			<h1>${this.escapeHtml(playlist.name)}</h1>
			<p style="color: var(--text-secondary); font-size: var(--text-lg); margin-top: var(--space-sm);">Advanced Analysis - Full Audio Features</p>
		</div>
		<div class="summary-section" style="padding: 40px 0;">
			<div class="stat-cards">
				<div class="stat-card">
					<div class="stat-card-value">${rows.length}</div>
					<div class="stat-card-label">Songs</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${uniqueArtists.size}</div>
					<div class="stat-card-label">Artists</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${uniqueAlbums.size}</div>
					<div class="stat-card-label">Albums</div>
				</div>
				<div class="stat-card">
					<div class="stat-card-value">${uniqueGenres.size}</div>
					<div class="stat-card-label">Genres</div>
				</div>
			</div>
			<div class="export-buttons">
				<button class="export-btn export-btn-csv" onclick="exportToCSV()">
					Export as CSV
				</button>
				<button class="export-btn export-btn-json" onclick="exportToJSON()">
					Export as JSON
				</button>
			</div>
		</div>
		<div class="visualizations" style="padding: 60px 0;">
			<section id="audio-features" class="viz-section">
				<h2 class="section-header">Audio Features Analysis</h2>
				<div class="chart-grid">
					<div class="chart-container">
						<div class="chart-title">Mood Quadrant (Energy vs Valence)</div>
						<div id="moodQuadrant" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Audio Features Radar</div>
						<div id="audioRadar" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Tempo Distribution</div>
						<div id="tempoDist" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Key Distribution</div>
						<div id="keyDist" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Energy vs Danceability</div>
						<div id="energyDanceability" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Acousticness vs Energy</div>
						<div id="acousticEnergy" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Tempo vs Energy</div>
						<div id="tempoEnergy" class="chart-wrapper"></div>
					</div>
				</div>
			</section>
			<section id="temporal-analysis" class="viz-section">
				<h2 class="section-header">Temporal Analysis</h2>
				<div class="chart-grid">
					<div class="chart-container">
						<div class="chart-title">Release Year Distribution</div>
						<div id="releaseYear" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Decade Breakdown</div>
						<div id="decadeBreakdown" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Addition Timeline</div>
						<div id="additionTimeline" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Popularity Over Time</div>
						<div id="popularityOverTime" class="chart-wrapper"></div>
					</div>
				</div>
			</section>
			<section id="artist-genre" class="viz-section">
				<h2 class="section-header">Artist & Genre Insights</h2>
				<div class="chart-grid">
					<div class="chart-container">
						<div class="chart-title">Top Artists</div>
						<div id="topArtists" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Genre Distribution</div>
						<div id="genreDist" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Artist Diversity</div>
						<div id="artistDiversity" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Top Record Labels</div>
						<div id="recordLabels" class="chart-wrapper"></div>
					</div>
				</div>
			</section>
			<section id="playlist-characteristics" class="viz-section">
				<h2 class="section-header">Playlist Characteristics</h2>
				<div class="chart-grid">
					<div class="chart-container">
						<div class="chart-title">Duration Distribution</div>
						<div id="durationDist" class="chart-wrapper"></div>
					</div>
					<div class="chart-container">
						<div class="chart-title">Explicit Content Breakdown</div>
						<div id="explicitContent" class="chart-wrapper"></div>
					</div>
					<div class="chart-container" style="grid-column: 1 / -1;">
						<div class="chart-title">Average Audio Features</div>
						<div class="stat-cards" id="avgFeatures"></div>
					</div>
					<div class="chart-container" style="grid-column: 1 / -1;">
						<h3 style="font-size: 18px; font-weight: 600; color: #333; margin-bottom: 20px;">Top 10 by Song Count</h3>
						<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 25px;">
							<div class="track-list">
								<div class="track-list-title">Top 10 Artists</div>
								<div id="top10Artists"></div>
							</div>
							<div class="track-list">
								<div class="track-list-title">Top 10 Albums</div>
								<div id="top10Albums"></div>
							</div>
							<div class="track-list">
								<div class="track-list-title">Top 10 Genres</div>
								<div id="top10Genres"></div>
							</div>
							<div class="track-list">
								<div class="track-list-title">Top 10 Labels</div>
								<div id="top10Labels"></div>
							</div>
						</div>
					</div>
				</div>
			</section>
			<section id="top-tracks" class="viz-section">
				<h2 class="section-header">Top 5 Songs by Audio Features</h2>
				<div class="chart-grid">
					<div class="track-list">
						<div class="track-list-title">Highest Danceability</div>
						<div id="topDanceability"></div>
					</div>
					<div class="track-list">
						<div class="track-list-title">Highest Energy</div>
						<div id="topEnergy"></div>
					</div>
					<div class="track-list">
						<div class="track-list-title">Highest Loudness</div>
						<div id="topLoudness"></div>
					</div>
					<div class="track-list">
						<div class="track-list-title">Highest Acousticness</div>
						<div id="topAcousticness"></div>
					</div>
					<div class="track-list">
						<div class="track-list-title">Most Valence (Happy)</div>
						<div id="topValence"></div>
					</div>
					<div class="track-list">
						<div class="track-list-title">Least Valence (Sad)</div>
						<div id="leastValence"></div>
					</div>
				</div>
			</section>
		</div>
		<div style="background: transparent; padding: 60px 40px;">
			<h2 style="font-size: clamp(28px, 4vw, 40px); font-weight: 900; color: var(--text-primary); margin-bottom: 40px; text-align: center; letter-spacing: -0.02em;">Complete Track Data</h2>
			<div class="table-wrapper">
				<table id="dataTable">
					<thead>
						<tr>${tableHeaders}</tr>
						<tr class="filter-row">${filterRow}</tr>
					</thead>
					<tbody id="tableBody">
						${tableRows}
					</tbody>
				</table>
			</div>
		</div>
	</div>
	<script>
		// Store original data
		const originalData = ${JSON.stringify(rawData)};
		const headers = ${JSON.stringify(headers)};
		let currentData = [...originalData];
		let sortColumn = -1;
		let sortDirection = 'none';

		// Format functions (same as in HTML generation)
		function formatDuration(ms) {
			if (!ms) return '';
			const seconds = Math.floor(parseInt(ms) / 1000);
			const minutes = Math.floor(seconds / 60);
			const secs = seconds % 60;
			return minutes + ':' + (secs < 10 ? '0' : '') + secs;
		}

		function formatDate(dateStr) {
			if (!dateStr) return '';
			return dateStr.split('-')[0];
		}

		function getCellValue(row, colIndex) {
			let value = row[colIndex] || '';
			const header = headers[colIndex];
			if (header === 'Duration (ms)') {
				return formatDuration(value);
			} else if (header === 'Release Date') {
				return formatDate(value);
			} else if (header === 'Explicit') {
				return value === 'true' ? '✓' : '';
			}
			return value.toString().toLowerCase();
		}

		function getRawValue(row, colIndex) {
			return row[colIndex] || '';
		}

		// Sorting function
		function sortTable(columnIndex) {
			const header = headers[columnIndex];
			const isNumeric = ['Duration (ms)', 'Popularity', 'Danceability', 'Energy', 'Key', 'Loudness', 
				'Mode', 'Speechiness', 'Acousticness', 'Instrumentalness', 'Liveness', 'Valence', 
				'Tempo', 'Time Signature'].includes(header);

			if (sortColumn === columnIndex) {
				if (sortDirection === 'asc') {
					sortDirection = 'desc';
				} else if (sortDirection === 'desc') {
					sortDirection = 'none';
					currentData = [...originalData];
					renderTable();
					updateSortIndicators();
					return;
				} else {
					sortDirection = 'asc';
				}
			} else {
				sortColumn = columnIndex;
				sortDirection = 'asc';
			}

			currentData.sort((a, b) => {
				let aVal, bVal;
				if (isNumeric) {
					aVal = parseFloat(getRawValue(a, columnIndex)) || 0;
					bVal = parseFloat(getRawValue(b, columnIndex)) || 0;
				} else {
					aVal = getCellValue(a, columnIndex);
					bVal = getCellValue(b, columnIndex);
				}

				if (sortDirection === 'asc') {
					return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
				} else {
					return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
				}
			});

			renderTable();
			updateSortIndicators();
		}

		function updateSortIndicators() {
			document.querySelectorAll('th.sortable').forEach((th, idx) => {
				th.setAttribute('data-sort', idx === sortColumn ? sortDirection : 'none');
			});
		}

		// Filtering function
		function filterTable() {
			const filters = Array.from(document.querySelectorAll('.filter-input')).map(input => 
				input.value.toLowerCase().trim()
			);

			currentData = originalData.filter(row => {
				return filters.every((filter, colIndex) => {
					if (!filter) return true;
					const value = getCellValue(row, colIndex);
					return value.includes(filter);
				});
			});

			// Re-apply sorting if active
			if (sortDirection !== 'none' && sortColumn >= 0) {
				const header = headers[sortColumn];
				const isNumeric = ['Duration (ms)', 'Popularity', 'Danceability', 'Energy', 'Key', 'Loudness', 
					'Mode', 'Speechiness', 'Acousticness', 'Instrumentalness', 'Liveness', 'Valence', 
					'Tempo', 'Time Signature'].includes(header);

				currentData.sort((a, b) => {
					let aVal, bVal;
					if (isNumeric) {
						aVal = parseFloat(getRawValue(a, sortColumn)) || 0;
						bVal = parseFloat(getRawValue(b, sortColumn)) || 0;
					} else {
						aVal = getCellValue(a, sortColumn);
						bVal = getCellValue(b, sortColumn);
					}

					if (sortDirection === 'asc') {
						return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
					} else {
						return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
					}
				});
			}

			renderTable();
			updateTrackCount();
		}

		function updateTrackCount() {
			// Track count is now in the stat cards, no need to update
		}

		// Export functions
		function exportToCSV() {
			const csvContent = headers.join(',') + '\\n' + 
				originalData.map(row => row.map(cell => {
					const value = (cell || '').toString();
					// Escape quotes and wrap in quotes if contains comma, quote, or newline
					if (value.includes(',') || value.includes('"') || value.includes('\\n')) {
						return '"' + value.replace(/"/g, '""') + '"';
					}
					return value;
				}).join(',')).join('\\n');
			
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = 'playlist_data.csv';
			link.click();
		}

		function exportToJSON() {
			const jsonData = originalData.map(row => {
				const obj = {};
				headers.forEach((header, idx) => {
					obj[header] = row[idx] || '';
				});
				return obj;
			});
			
			const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
			const link = document.createElement('a');
			link.href = URL.createObjectURL(blob);
			link.download = 'playlist_data.json';
			link.click();
		}

		function escapeHtml(text) {
			if (!text) return '';
			const map = {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#039;'
			};
			return text.toString().replace(/[&<>"']/g, m => map[m]);
		}

		function renderTable() {
			const tbody = document.getElementById('tableBody');
			tbody.innerHTML = currentData.map(row => {
				const cells = row.map((cell, idx) => {
					let value = cell || '';
					const header = headers[idx];
					if (header === 'Duration (ms)') {
						value = formatDuration(value);
					} else if (header === 'Release Date') {
						value = formatDate(value);
					} else if (header === 'Explicit') {
						value = value === 'true' ? '✓' : '';
					}
					return '<td>' + escapeHtml(value) + '</td>';
				}).join('');
				return '<tr>' + cells + '</tr>';
			}).join('');
		}

		// Data processing functions
		function getColumnIndex(headerName) {
			// Try exact match first
			let idx = headers.indexOf(headerName);
			if (idx >= 0) return idx;
			
			// Try with quotes removed
			idx = headers.findIndex(h => h.replace(/^"|"$/g, '') === headerName);
			if (idx >= 0) return idx;
			
			// Try case-insensitive
			idx = headers.findIndex(h => h.toLowerCase().replace(/^"|"$/g, '') === headerName.toLowerCase());
			if (idx >= 0) return idx;
			
			console.warn('Column not found:', headerName, 'Available headers:', headers);
			return -1;
		}

		function getNumericValue(row, colIndex) {
			if (colIndex < 0 || colIndex >= row.length) return 0;
			const val = parseFloat(row[colIndex]) || 0;
			return isNaN(val) ? 0 : val;
		}

		function getStringValue(row, colIndex) {
			if (colIndex < 0 || colIndex >= row.length) return '';
			return (row[colIndex] || '').toString().replace(/^"|"$/g, '');
		}

		// Key mapping
		const keyNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
		const modeNames = ['Minor', 'Major'];

		// Process data for visualizations
		function processData() {
			const trackUriIdx = getColumnIndex('Track URI');
			const trackNameIdx = getColumnIndex('Track Name');
			const albumNameIdx = getColumnIndex('Album Name');
			const artistIdx = getColumnIndex('Artist Name(s)');
			const releaseDateIdx = getColumnIndex('Release Date');
			const durationIdx = getColumnIndex('Duration (ms)');
			const popularityIdx = getColumnIndex('Popularity');
			const explicitIdx = getColumnIndex('Explicit');
			const addedAtIdx = getColumnIndex('Added At');
			const genresIdx = getColumnIndex('Genres');
			const recordLabelIdx = getColumnIndex('Record Label');
			const danceabilityIdx = getColumnIndex('Danceability');
			const energyIdx = getColumnIndex('Energy');
			const valenceIdx = getColumnIndex('Valence');
			const tempoIdx = getColumnIndex('Tempo');
			const keyIdx = getColumnIndex('Key');
			const loudnessIdx = getColumnIndex('Loudness');
			const modeIdx = getColumnIndex('Mode');
			const acousticnessIdx = getColumnIndex('Acousticness');
			const instrumentalnessIdx = getColumnIndex('Instrumentalness');
			const speechinessIdx = getColumnIndex('Speechiness');
			const livenessIdx = getColumnIndex('Liveness');

			const processed = originalData.map(row => ({
				trackUri: getStringValue(row, trackUriIdx),
				trackName: getStringValue(row, trackNameIdx),
				albumName: getStringValue(row, albumNameIdx),
				artist: getStringValue(row, artistIdx),
				releaseDate: getStringValue(row, releaseDateIdx),
				duration: getNumericValue(row, durationIdx),
				popularity: getNumericValue(row, popularityIdx),
				explicit: getStringValue(row, explicitIdx).toLowerCase() === 'true',
				addedAt: getStringValue(row, addedAtIdx),
				genres: getStringValue(row, genresIdx),
				recordLabel: getStringValue(row, recordLabelIdx),
				danceability: getNumericValue(row, danceabilityIdx),
				energy: getNumericValue(row, energyIdx),
				valence: getNumericValue(row, valenceIdx),
				tempo: getNumericValue(row, tempoIdx),
				key: Math.round(getNumericValue(row, keyIdx)),
				loudness: getNumericValue(row, loudnessIdx),
				mode: Math.round(getNumericValue(row, modeIdx)),
				acousticness: getNumericValue(row, acousticnessIdx),
				instrumentalness: getNumericValue(row, instrumentalnessIdx),
				speechiness: getNumericValue(row, speechinessIdx),
				liveness: getNumericValue(row, livenessIdx)
			}));

			return processed;
		}

		// Custom ApexCharts theme configuration
		const chartColors = ['#1DB954', '#00D4FF', '#FF00E5', '#FFB800', '#8B5CF6'];
		
		// Scroll reveal animation
		const observerOptions = {
			threshold: 0.1,
			rootMargin: '0px 0px -50px 0px'
		};
		
		const observer = new IntersectionObserver((entries) => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					entry.target.classList.add('visible');
				}
			});
		}, observerOptions);
		
		// Initialize all charts
		function initializeCharts() {
			try {
				console.log('Starting chart initialization...');
				console.log('Original data length:', originalData.length);
				console.log('Headers:', headers);
				
				// Observe all sections for scroll animations
				document.querySelectorAll('.viz-section').forEach(section => {
					observer.observe(section);
				});
				
				// Process data here to ensure it's fresh
				const processedData = processData();
				
				console.log('Processed data length:', processedData.length);
				console.log('Sample processed data:', processedData[0]);

				// Validate data
				if (!processedData || processedData.length === 0) {
					console.error('No data to visualize');
					return;
				}

				// Validate ApexCharts is available
				if (typeof ApexCharts === 'undefined') {
					console.error('ApexCharts is not defined');
					return;
				}

				console.log('ApexCharts loaded successfully');

				// 1. Mood Quadrant
			const moodContainer = document.querySelector("#moodQuadrant");
			if (!moodContainer) {
				console.error('Mood quadrant container not found');
			} else {
				console.log('Rendering mood quadrant...');
				const moodData = processedData.map(t => ({
					x: t.energy,
					y: t.valence,
					track: t.trackName,
					artist: t.artist
				}));

				console.log('Mood data points:', moodData.length);

				const moodChart = new ApexCharts(moodContainer, {
				chart: { 
					type: 'scatter', 
					height: 400, 
					zoom: { enabled: true },
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'radial',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						inverseColors: false,
						opacityFrom: 0.8,
						opacityTo: 0.3,
						stops: [0, 100]
					}
				},
				series: [{
					name: 'Tracks',
					data: moodData
				}],
				xaxis: {
					title: { 
						text: 'Energy',
						style: { color: '#FFFFFF', fontSize: '14px', fontWeight: 600 }
					},
					min: 0,
					max: 1,
					labels: { style: { colors: '#FFFFFF' } }
				},
				yaxis: {
					title: { 
						text: 'Valence',
						style: { color: '#FFFFFF', fontSize: '14px', fontWeight: 600 }
					},
					min: 0,
					max: 1,
					labels: { style: { colors: '#FFFFFF' } }
				},
				grid: {
					borderColor: 'rgba(255, 255, 255, 0.1)'
				},
				tooltip: {
					theme: 'dark',
					custom: function({seriesIndex, dataPointIndex, w}) {
						const data = moodData[dataPointIndex];
						return '<div style="padding: 10px; background: #1a1a1a; color: #FFFFFF; border-radius: 8px;"><strong>' + escapeHtml(data.track) + '</strong><br/>' + 
							escapeHtml(data.artist) + '<br/>Energy: ' + data.x.toFixed(2) + '<br/>Valence: ' + data.y.toFixed(2) + '</div>';
					}
				},
				annotations: {
					texts: [{
						text: 'Happy/Energetic',
						x: 0.75,
						y: 0.75,
						textAnchor: 'middle',
						fontSize: '12px',
						fillColor: '#fff',
						backgroundColor: 'rgba(29, 185, 84, 0.3)',
						padding: { left: 5, right: 5, top: 5, bottom: 5 }
					}, {
						text: 'Angry/Intense',
						x: 0.75,
						y: 0.25,
						textAnchor: 'middle',
						fontSize: '12px',
						fillColor: '#fff',
						backgroundColor: 'rgba(255, 0, 0, 0.3)',
						padding: { left: 5, right: 5, top: 5, bottom: 5 }
					}, {
						text: 'Calm/Peaceful',
						x: 0.25,
						y: 0.75,
						textAnchor: 'middle',
						fontSize: '12px',
						fillColor: '#fff',
						backgroundColor: 'rgba(0, 123, 255, 0.3)',
						padding: { left: 5, right: 5, top: 5, bottom: 5 }
					}, {
						text: 'Sad/Melancholic',
						x: 0.25,
						y: 0.25,
						textAnchor: 'middle',
						fontSize: '12px',
						fillColor: '#fff',
						backgroundColor: 'rgba(128, 128, 128, 0.3)',
						padding: { left: 5, right: 5, top: 5, bottom: 5 }
					}]
				}
				});
				moodChart.render();
				console.log('Mood quadrant rendered');
			}

			// Calculate average audio features for use across multiple charts
			const avgDanceability = processedData.reduce((sum, t) => sum + t.danceability, 0) / processedData.length;
			const avgEnergy = processedData.reduce((sum, t) => sum + t.energy, 0) / processedData.length;
			const avgValence = processedData.reduce((sum, t) => sum + t.valence, 0) / processedData.length;
			const avgAcousticness = processedData.reduce((sum, t) => sum + t.acousticness, 0) / processedData.length;
			const avgInstrumentalness = processedData.reduce((sum, t) => sum + t.instrumentalness, 0) / processedData.length;
			const avgSpeechiness = processedData.reduce((sum, t) => sum + t.speechiness, 0) / processedData.length;
			const avgLiveness = processedData.reduce((sum, t) => sum + t.liveness, 0) / processedData.length;
			const avgTempo = processedData.reduce((sum, t) => sum + t.tempo, 0) / processedData.length;
			const avgPopularity = processedData.reduce((sum, t) => sum + t.popularity, 0) / processedData.length;

			// 2. Audio Features Radar
			const radarContainer = document.querySelector("#audioRadar");
			if (!radarContainer) {
				console.error('Audio radar container not found');
			} else {
				console.log('Rendering audio radar...');

				const radarChart = new ApexCharts(radarContainer, {
					chart: { 
						type: 'radar', 
						height: 400,
						background: 'transparent',
						toolbar: { show: false }
					},
					colors: ['#1DB954'],
					fill: {
						type: 'gradient',
						gradient: {
							shade: 'dark',
							type: 'radial',
							shadeIntensity: 0.5,
							gradientToColors: ['#00D4FF'],
							opacityFrom: 0.8,
							opacityTo: 0.3
						}
					},
					series: [{
						name: 'Average',
						data: [
							avgDanceability * 100,
							avgEnergy * 100,
							avgValence * 100,
							avgAcousticness * 100,
							avgInstrumentalness * 100,
							avgSpeechiness * 100,
							avgLiveness * 100
						]
					}],
					labels: ['Danceability', 'Energy', 'Valence', 'Acousticness', 'Instrumentalness', 'Speechiness', 'Liveness'],
					colors: ['#1DB954'],
					yaxis: { 
						max: 100,
						labels: { style: { colors: '#FFFFFF' } }
					},
					plotOptions: {
						radar: {
							polygons: {
								strokeColors: 'rgba(255, 255, 255, 0.1)'
							}
						}
					},
					grid: {
						borderColor: 'rgba(255, 255, 255, 0.1)'
					},
					tooltip: {
						theme: 'dark'
					}
				});
				radarChart.render();
				console.log('Audio radar rendered');
			}

			// 3. Tempo Distribution
			const tempoDistContainer = document.querySelector("#tempoDist");
			if (!tempoDistContainer) {
				console.error('Tempo distribution container not found');
			} else {
				console.log('Rendering tempo distribution...');
				const tempoRanges = [
				{ label: '60-80', min: 60, max: 80 },
				{ label: '80-100', min: 80, max: 100 },
				{ label: '100-120', min: 100, max: 120 },
				{ label: '120-140', min: 120, max: 140 },
				{ label: '140-160', min: 140, max: 160 },
				{ label: '160+', min: 160, max: 999 }
			];
				const tempoCounts = tempoRanges.map(range => 
					processedData.filter(t => t.tempo >= range.min && (range.max === 999 || t.tempo < range.max)).length
				);

				const tempoChart = new ApexCharts(tempoDistContainer, {
				chart: { 
					type: 'bar', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 1,
						opacityTo: 0.7,
						stops: [0, 100]
					}
				},
				series: [{
					name: 'Tracks',
					data: tempoCounts
				}],
					xaxis: { 
						categories: tempoRanges.map(r => r.label + ' BPM'),
						labels: { style: { colors: '#FFFFFF' } }
					},
					yaxis: { labels: { style: { colors: '#FFFFFF' } } },
					grid: {
						borderColor: 'rgba(255, 255, 255, 0.1)'
					},
					tooltip: {
						theme: 'dark'
					}
				});
				tempoChart.render();
				console.log('Tempo distribution rendered');
			}

			// 4. Key Distribution
			const keyDistContainer = document.querySelector("#keyDist");
			if (!keyDistContainer) {
				console.error('Key distribution container not found');
			} else {
				console.log('Rendering key distribution...');
				const keyCounts = new Array(12).fill(0);
				processedData.forEach(t => {
					if (t.key >= 0 && t.key < 12) keyCounts[t.key]++;
				});

				const keyChart = new ApexCharts(keyDistContainer, {
				chart: { 
					type: 'bar', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#FF00E5'],
						opacityFrom: 1,
						opacityTo: 0.7
					}
				},
				series: [{
					name: 'Tracks',
					data: keyCounts
				}],
					xaxis: { 
						categories: keyNames,
						labels: { style: { colors: '#FFFFFF' } }
					},
					yaxis: { labels: { style: { colors: '#FFFFFF' } } },
					grid: {
						borderColor: 'rgba(255, 255, 255, 0.1)'
					},
					tooltip: {
						theme: 'dark'
					}
				});
				keyChart.render();
				console.log('Key distribution rendered');
			}

			// 5. Energy vs Danceability
			const energyDanceContainer = document.querySelector("#energyDanceability");
			if (!energyDanceContainer) {
				console.error('Energy vs Danceability container not found');
			} else {
			const energyDanceData = processedData.map(t => ({
				x: t.danceability,
				y: t.energy,
				track: t.trackName,
				artist: t.artist
			}));

				const energyDanceChart = new ApexCharts(energyDanceContainer, {
				chart: { 
					type: 'scatter', 
					height: 400, 
					zoom: { enabled: true },
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'radial',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 0.8,
						opacityTo: 0.3
					}
				},
				series: [{
					name: 'Tracks',
					data: energyDanceData
				}],
				xaxis: { title: { text: 'Danceability' }, min: 0, max: 1 },
				yaxis: { title: { text: 'Energy' }, min: 0, max: 1 },
				tooltip: {
					theme: 'dark',
					custom: function({seriesIndex, dataPointIndex, w}) {
						const data = energyDanceData[dataPointIndex];
						return '<div style="padding: 10px; background: #1a1a1a; color: #FFFFFF; border-radius: 8px;"><strong>' + escapeHtml(data.track) + '</strong><br/>' + 
							escapeHtml(data.artist) + '<br/>Danceability: ' + data.x.toFixed(2) + '<br/>Energy: ' + data.y.toFixed(2) + '</div>';
					}
				},
				grid: {
					borderColor: 'rgba(255, 255, 255, 0.1)'
				}
				});
				energyDanceChart.render();
			}

			// 6. Acousticness vs Energy
			const acousticEnergyContainer = document.querySelector("#acousticEnergy");
			if (!acousticEnergyContainer) {
				console.error('Acousticness vs Energy container not found');
			} else {
			const acousticEnergyData = processedData.map(t => ({
				x: t.acousticness,
				y: t.energy,
				track: t.trackName,
				artist: t.artist
			}));

				const acousticEnergyChart = new ApexCharts(acousticEnergyContainer, {
				chart: { 
					type: 'scatter', 
					height: 400, 
					zoom: { enabled: true },
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'radial',
						shadeIntensity: 0.5,
						gradientToColors: ['#FF00E5'],
						opacityFrom: 0.8,
						opacityTo: 0.3
					}
				},
				series: [{
					name: 'Tracks',
					data: acousticEnergyData
				}],
				xaxis: { title: { text: 'Acousticness' }, min: 0, max: 1 },
				yaxis: { title: { text: 'Energy' }, min: 0, max: 1 },
				tooltip: {
					theme: 'dark',
					custom: function({seriesIndex, dataPointIndex, w}) {
						const data = acousticEnergyData[dataPointIndex];
						return '<div style="padding: 10px; background: #1a1a1a; color: #FFFFFF; border-radius: 8px;"><strong>' + escapeHtml(data.track) + '</strong><br/>' + 
							escapeHtml(data.artist) + '<br/>Acousticness: ' + data.x.toFixed(2) + '<br/>Energy: ' + data.y.toFixed(2) + '</div>';
					}
				},
				grid: {
					borderColor: 'rgba(255, 255, 255, 0.1)'
				}
				});
				acousticEnergyChart.render();
			}

			// 7. Tempo vs Energy
			const tempoEnergyContainer = document.querySelector("#tempoEnergy");
			if (!tempoEnergyContainer) {
				console.error('Tempo vs Energy container not found');
			} else {
			const tempoEnergyData = processedData.map(t => ({
				x: t.tempo,
				y: t.energy,
				track: t.trackName,
				artist: t.artist
			}));

				const tempoEnergyChart = new ApexCharts(tempoEnergyContainer, {
				chart: { 
					type: 'scatter', 
					height: 400, 
					zoom: { enabled: true },
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'radial',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 0.8,
						opacityTo: 0.3
					}
				},
				series: [{
					name: 'Tracks',
					data: tempoEnergyData
				}],
				xaxis: { title: { text: 'Tempo (BPM)' } },
				yaxis: { title: { text: 'Energy' }, min: 0, max: 1 },
				tooltip: {
					theme: 'dark',
					custom: function({seriesIndex, dataPointIndex, w}) {
						const data = tempoEnergyData[dataPointIndex];
						return '<div style="padding: 10px; background: #1a1a1a; color: #FFFFFF; border-radius: 8px;"><strong>' + escapeHtml(data.track) + '</strong><br/>' + 
							escapeHtml(data.artist) + '<br/>Tempo: ' + data.x.toFixed(0) + ' BPM<br/>Energy: ' + data.y.toFixed(2) + '</div>';
					}
				},
				grid: {
					borderColor: 'rgba(255, 255, 255, 0.1)'
				}
				});
				tempoEnergyChart.render();
			}

			// 8. Release Year Distribution
			const releaseYearContainer = document.querySelector("#releaseYear");
			if (!releaseYearContainer) {
				console.error('Release year container not found');
			} else {
			const yearCounts = {};
			processedData.forEach(t => {
				const year = t.releaseDate ? t.releaseDate.split('-')[0] : 'Unknown';
				yearCounts[year] = (yearCounts[year] || 0) + 1;
			});
			const sortedYears = Object.keys(yearCounts).sort();
			const yearData = sortedYears.map(y => yearCounts[y]);

				const releaseYearChart = new ApexCharts(releaseYearContainer, {
				chart: { 
					type: 'bar', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 1,
						opacityTo: 0.7
					}
				},
				series: [{
					name: 'Tracks',
					data: yearData
				}],
					xaxis: { 
						categories: sortedYears,
						labels: { style: { colors: '#FFFFFF' } }
					},
					yaxis: { labels: { style: { colors: '#FFFFFF' } } }
				});
				releaseYearChart.render();
			}

			// 9. Decade Breakdown
			const decadeContainer = document.querySelector("#decadeBreakdown");
			if (!decadeContainer) {
				console.error('Decade breakdown container not found');
			} else {
			const decadeCounts = {};
			processedData.forEach(t => {
				const year = t.releaseDate ? parseInt(t.releaseDate.split('-')[0]) : null;
				if (year && !isNaN(year)) {
					const decade = Math.floor(year / 10) * 10;
					const decadeLabel = decade + 's';
					decadeCounts[decadeLabel] = (decadeCounts[decadeLabel] || 0) + 1;
				}
			});
			const decadeLabels = Object.keys(decadeCounts).sort();
			const decadeData = decadeLabels.map(d => decadeCounts[d]);

				const decadeChart = new ApexCharts(decadeContainer, {
				chart: { 
					type: 'donut', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				series: decadeData,
				labels: decadeLabels,
				colors: ['#1DB954', '#00D4FF', '#FF00E5', '#FFB800', '#8B5CF6', '#1ed760', '#0099cc', '#cc00cc', '#ff9900', '#9966ff'],
				legend: { 
					position: 'bottom',
					labels: { colors: '#FFFFFF' }
				},
				stroke: {
					show: true,
					width: 2,
					colors: ['#0a0a0a']
				}
				});
				decadeChart.render();
			}

			// 10. Addition Timeline
			const additionTimelineContainer = document.querySelector("#additionTimeline");
			if (!additionTimelineContainer) {
				console.error('Addition timeline container not found');
			} else {
			const additionCounts = {};
			processedData.forEach(t => {
				if (t.addedAt) {
					const date = new Date(t.addedAt);
					const year = date.getFullYear();
					additionCounts[year] = (additionCounts[year] || 0) + 1;
				}
			});
			const sortedAdditionYears = Object.keys(additionCounts).sort();
			const additionData = sortedAdditionYears.map(y => additionCounts[y]);

				const additionChart = new ApexCharts(additionTimelineContainer, {
				chart: { 
					type: 'line', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 0.8,
						opacityTo: 0.2,
						stops: [0, 100]
					}
				},
				series: [{
					name: 'Tracks Added',
					data: additionData
				}],
				xaxis: { 
					categories: sortedAdditionYears,
					labels: { style: { colors: '#FFFFFF' } }
				},
				yaxis: { labels: { style: { colors: '#FFFFFF' } } },
				stroke: { curve: 'smooth', width: 3 }
				});
				additionChart.render();
			}

			// 11. Popularity Over Time
			const popularityContainer = document.querySelector("#popularityOverTime");
			if (!popularityContainer) {
				console.error('Popularity over time container not found');
			} else {
			const popularityByYear = {};
			const popularityCounts = {};
			processedData.forEach(t => {
				const year = t.releaseDate ? t.releaseDate.split('-')[0] : null;
				if (year && !isNaN(parseInt(year))) {
					if (!popularityByYear[year]) {
						popularityByYear[year] = 0;
						popularityCounts[year] = 0;
					}
					popularityByYear[year] += t.popularity;
					popularityCounts[year]++;
				}
			});
			const sortedPopYears = Object.keys(popularityByYear).sort();
			const avgPopularity = sortedPopYears.map(y => popularityByYear[y] / popularityCounts[y]);

				const popularityChart = new ApexCharts(popularityContainer, {
				chart: { 
					type: 'line', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#FF00E5'],
						opacityFrom: 0.8,
						opacityTo: 0.2,
						stops: [0, 100]
					}
				},
				series: [{
					name: 'Average Popularity',
					data: avgPopularity
				}],
				xaxis: { 
					categories: sortedPopYears,
					labels: { style: { colors: '#FFFFFF' } }
				},
				yaxis: { 
					max: 100,
					labels: { style: { colors: '#FFFFFF' } }
				},
				stroke: { curve: 'smooth', width: 3 }
				});
				popularityChart.render();
			}

			// Calculate artist counts for use in multiple charts
			const artistCounts = {};
			processedData.forEach(t => {
				const artists = t.artist.split(';').map(a => a.trim()).filter(a => a);
				artists.forEach(artist => {
					artistCounts[artist] = (artistCounts[artist] || 0) + 1;
				});
			});

			// 12. Top Artists
			const topArtistsContainer = document.querySelector("#topArtists");
			if (!topArtistsContainer) {
				console.error('Top artists container not found');
			} else {
				const topArtists = Object.entries(artistCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 15);
				const artistLabels = topArtists.map(a => a[0]);
				const artistData = topArtists.map(a => a[1]);

				const topArtistsChart = new ApexCharts(topArtistsContainer, {
					chart: { 
						type: 'bar', 
						height: 500, 
						horizontal: true,
						background: 'transparent',
						toolbar: { show: false }
					},
					colors: ['#1DB954'],
					fill: {
						type: 'gradient',
						gradient: {
							shade: 'dark',
							type: 'horizontal',
							shadeIntensity: 0.5,
							gradientToColors: ['#00D4FF'],
							opacityFrom: 1,
							opacityTo: 0.7
						}
					},
					series: [{
						name: 'Tracks',
						data: artistData
					}],
					xaxis: { 
						categories: artistLabels,
						labels: { style: { colors: '#FFFFFF' } }
					},
					yaxis: { labels: { style: { colors: '#FFFFFF' } } }
				});
				topArtistsChart.render();
			}

			// 13. Genre Distribution
			const genreDistContainer = document.querySelector("#genreDist");
			if (!genreDistContainer) {
				console.error('Genre distribution container not found');
			} else {
			const genreCounts = {};
			processedData.forEach(t => {
				if (t.genres) {
					const genres = t.genres.split(',').map(g => g.trim()).filter(g => g);
					genres.forEach(genre => {
						genreCounts[genre] = (genreCounts[genre] || 0) + 1;
					});
				}
			});
			const topGenres = Object.entries(genreCounts)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10);
			const genreLabels = topGenres.map(g => g[0]);
			const genreData = topGenres.map(g => g[1]);

				const genreChart = new ApexCharts(genreDistContainer, {
				chart: { 
					type: 'donut', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				series: genreData,
				labels: genreLabels,
				colors: ['#1DB954', '#00D4FF', '#FF00E5', '#FFB800', '#8B5CF6', '#1ed760', '#0099cc', '#cc00cc', '#ff9900', '#9966ff'],
				legend: { 
					position: 'bottom',
					labels: { colors: '#FFFFFF' }
				},
				stroke: {
					show: true,
					width: 2,
					colors: ['#0a0a0a']
				}
				});
				genreChart.render();
			}

			// 14. Artist Diversity
			const artistDiversityContainer = document.querySelector("#artistDiversity");
			if (!artistDiversityContainer) {
				console.error('Artist diversity container not found');
			} else {
				const uniqueArtistsForChart = Object.keys(artistCounts).length;
				const mostTracksByArtist = uniqueArtistsForChart > 0 ? Math.max(...Object.values(artistCounts)) : 0;
				const diversityMetric = (uniqueArtistsForChart / processedData.length * 100).toFixed(1);

				artistDiversityContainer.innerHTML = 
					'<div class="stat-cards">' +
						'<div class="stat-card">' +
							'<div class="stat-card-value">' + uniqueArtistsForChart + '</div>' +
							'<div class="stat-card-label">Unique Artists</div>' +
						'</div>' +
						'<div class="stat-card">' +
							'<div class="stat-card-value">' + mostTracksByArtist + '</div>' +
							'<div class="stat-card-label">Most Tracks by One Artist</div>' +
						'</div>' +
						'<div class="stat-card">' +
							'<div class="stat-card-value">' + diversityMetric + '%</div>' +
							'<div class="stat-card-label">Diversity Ratio</div>' +
						'</div>' +
					'</div>';
			}

			// 15. Record Labels
			const recordLabelsContainer = document.querySelector("#recordLabels");
			if (!recordLabelsContainer) {
				console.error('Record labels container not found');
			} else {
				const labelCounts = {};
				processedData.forEach(t => {
					if (t.recordLabel && t.recordLabel.trim()) {
						labelCounts[t.recordLabel] = (labelCounts[t.recordLabel] || 0) + 1;
					}
				});
				const topLabels = Object.entries(labelCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10);
				
				if (topLabels.length > 0) {
					const labelLabels = topLabels.map(l => l[0]);
					const labelData = topLabels.map(l => l[1]);

					new ApexCharts(recordLabelsContainer, {
						chart: { 
							type: 'bar', 
							height: 400, 
							horizontal: true,
							background: 'transparent',
							toolbar: { show: false }
						},
						colors: ['#1DB954'],
						fill: {
							type: 'gradient',
							gradient: {
								shade: 'dark',
								type: 'horizontal',
								shadeIntensity: 0.5,
								gradientToColors: ['#FF00E5'],
								opacityFrom: 1,
								opacityTo: 0.7
							}
						},
						series: [{
							name: 'Tracks',
							data: labelData
						}],
						xaxis: { 
							categories: labelLabels,
							labels: { style: { colors: '#FFFFFF' } }
						},
						yaxis: { labels: { style: { colors: '#FFFFFF' } } }
					}).render();
				} else {
					recordLabelsContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No record label data available</p>';
				}
			}

			// 16. Duration Distribution
			const durationDistContainer = document.querySelector("#durationDist");
			if (!durationDistContainer) {
				console.error('Duration distribution container not found');
			} else {
			const durationRanges = [
				{ label: '0-2 min', min: 0, max: 120000 },
				{ label: '2-4 min', min: 120000, max: 240000 },
				{ label: '4-6 min', min: 240000, max: 360000 },
				{ label: '6-8 min', min: 360000, max: 480000 },
				{ label: '8+ min', min: 480000, max: Infinity }
			];
			const durationCounts = durationRanges.map(range => 
				processedData.filter(t => t.duration >= range.min && t.duration < range.max).length
			);

				const durationChart = new ApexCharts(durationDistContainer, {
				chart: { 
					type: 'bar', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				colors: ['#1DB954'],
				fill: {
					type: 'gradient',
					gradient: {
						shade: 'dark',
						type: 'vertical',
						shadeIntensity: 0.5,
						gradientToColors: ['#00D4FF'],
						opacityFrom: 1,
						opacityTo: 0.7
					}
				},
				series: [{
					name: 'Tracks',
					data: durationCounts
				}],
					xaxis: { 
						categories: durationRanges.map(r => r.label),
						labels: { style: { colors: '#FFFFFF' } }
					},
					yaxis: { labels: { style: { colors: '#FFFFFF' } } }
				});
				durationChart.render();
			}

			// 17. Explicit Content
			const explicitContainer = document.querySelector("#explicitContent");
			if (!explicitContainer) {
				console.error('Explicit content container not found');
			} else {
			const explicitCount = processedData.filter(t => t.explicit).length;
			const nonExplicitCount = processedData.length - explicitCount;

				const explicitChart = new ApexCharts(explicitContainer, {
				chart: { 
					type: 'donut', 
					height: 400,
					background: 'transparent',
					toolbar: { show: false }
				},
				series: [explicitCount, nonExplicitCount],
				labels: ['Explicit', 'Non-Explicit'],
				colors: ['#FF00E5', '#1DB954'],
				legend: { 
					position: 'bottom',
					labels: { colors: '#FFFFFF' }
				},
				stroke: {
					show: true,
					width: 2,
					colors: ['#0a0a0a']
				}
				});
				explicitChart.render();
			}

			// 18. Average Audio Features Cards
			const avgFeaturesContainer = document.querySelector("#avgFeatures");
			if (!avgFeaturesContainer) {
				console.error('Average features container not found');
			} else {
				avgFeaturesContainer.innerHTML = 
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + (avgDanceability * 100).toFixed(1) + '%</div>' +
					'<div class="stat-card-label">Danceability</div>' +
				'</div>' +
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + (avgEnergy * 100).toFixed(1) + '%</div>' +
					'<div class="stat-card-label">Energy</div>' +
				'</div>' +
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + (avgValence * 100).toFixed(1) + '%</div>' +
					'<div class="stat-card-label">Valence</div>' +
				'</div>' +
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + avgTempo.toFixed(0) + '</div>' +
					'<div class="stat-card-label">Tempo (BPM)</div>' +
				'</div>' +
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + (avgAcousticness * 100).toFixed(1) + '%</div>' +
					'<div class="stat-card-label">Acousticness</div>' +
				'</div>' +
				'<div class="stat-card">' +
					'<div class="stat-card-value">' + avgPopularity.toFixed(0) + '</div>' +
					'<div class="stat-card-label">Popularity</div>' +
				'</div>';
			}

			// 19. Top 10 Artists, Albums, Genres, and Labels by Song Count
			
			// Top 10 Artists
			const top10ArtistsContainer = document.querySelector("#top10Artists");
			if (top10ArtistsContainer) {
				const topArtistsList = Object.entries(artistCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10);
				top10ArtistsContainer.innerHTML = topArtistsList.map((item, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. ' + escapeHtml(item[0]) + '</div>' +
						'</div>' +
						'<div class="track-score">' + item[1] + ' songs</div>' +
					'</div>'
				).join('');
			}

			// Top 10 Albums
			const top10AlbumsContainer = document.querySelector("#top10Albums");
			if (top10AlbumsContainer) {
				const albumCounts = {};
				processedData.forEach(t => {
					if (t.albumName && t.albumName.trim()) {
						albumCounts[t.albumName] = (albumCounts[t.albumName] || 0) + 1;
					}
				});
				const topAlbumsList = Object.entries(albumCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10);
				top10AlbumsContainer.innerHTML = topAlbumsList.map((item, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. ' + escapeHtml(item[0]) + '</div>' +
						'</div>' +
						'<div class="track-score">' + item[1] + ' songs</div>' +
					'</div>'
				).join('');
			}

			// Top 10 Genres
			const top10GenresContainer = document.querySelector("#top10Genres");
			if (top10GenresContainer) {
				const genreCounts = {};
				processedData.forEach(t => {
					if (t.genres) {
						const genres = t.genres.split(',').map(g => g.trim()).filter(g => g);
						genres.forEach(genre => {
							genreCounts[genre] = (genreCounts[genre] || 0) + 1;
						});
					}
				});
				const topGenresList = Object.entries(genreCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10);
				top10GenresContainer.innerHTML = topGenresList.map((item, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. ' + escapeHtml(item[0]) + '</div>' +
						'</div>' +
						'<div class="track-score">' + item[1] + ' songs</div>' +
					'</div>'
				).join('');
			}

			// Top 10 Labels
			const top10LabelsContainer = document.querySelector("#top10Labels");
			if (top10LabelsContainer) {
				const labelCounts = {};
				processedData.forEach(t => {
					if (t.recordLabel && t.recordLabel.trim()) {
						labelCounts[t.recordLabel] = (labelCounts[t.recordLabel] || 0) + 1;
					}
				});
				const topLabelsList = Object.entries(labelCounts)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10);
				top10LabelsContainer.innerHTML = topLabelsList.map((item, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. ' + escapeHtml(item[0]) + '</div>' +
						'</div>' +
						'<div class="track-score">' + item[1] + ' songs</div>' +
					'</div>'
				).join('');
			}

			// 20. Top 5 Songs by Various Audio Features
			
			// Top Danceability
			const topDanceabilityContainer = document.querySelector("#topDanceability");
			if (topDanceabilityContainer) {
				const topDanceabilityTracks = [...processedData].sort((a, b) => b.danceability - a.danceability).slice(0, 5);
				topDanceabilityContainer.innerHTML = topDanceabilityTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + (t.danceability * 100).toFixed(1) + '%</div>' +
					'</div>'
				).join('');
			}

			// Top Energy
			const topEnergyContainer = document.querySelector("#topEnergy");
			if (topEnergyContainer) {
				const topEnergyTracks = [...processedData].sort((a, b) => b.energy - a.energy).slice(0, 5);
				topEnergyContainer.innerHTML = topEnergyTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + (t.energy * 100).toFixed(1) + '%</div>' +
					'</div>'
				).join('');
			}

			// Top Loudness
			const topLoudnessContainer = document.querySelector("#topLoudness");
			if (topLoudnessContainer) {
				const topLoudnessTracks = [...processedData]
					.filter(t => t.loudness && t.loudness !== 0)
					.sort((a, b) => b.loudness - a.loudness)
					.slice(0, 5);
				topLoudnessContainer.innerHTML = topLoudnessTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + t.loudness.toFixed(1) + ' dB</div>' +
					'</div>'
				).join('');
			}

			// Top Acousticness
			const topAcousticnessContainer = document.querySelector("#topAcousticness");
			if (topAcousticnessContainer) {
				const topAcousticnessTracks = [...processedData].sort((a, b) => b.acousticness - a.acousticness).slice(0, 5);
				topAcousticnessContainer.innerHTML = topAcousticnessTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + (t.acousticness * 100).toFixed(1) + '%</div>' +
					'</div>'
				).join('');
			}

			// Most Valence (Happy)
			const topValenceContainer = document.querySelector("#topValence");
			if (topValenceContainer) {
				const topValenceTracks = [...processedData].sort((a, b) => b.valence - a.valence).slice(0, 5);
				topValenceContainer.innerHTML = topValenceTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + (t.valence * 100).toFixed(1) + '%</div>' +
					'</div>'
				).join('');
			}

			// Least Valence (Sad)
			const leastValenceContainer = document.querySelector("#leastValence");
			if (leastValenceContainer) {
				const leastValenceTracks = [...processedData].sort((a, b) => a.valence - b.valence).slice(0, 5);
				leastValenceContainer.innerHTML = leastValenceTracks.map((t, i) => 
					'<div class="track-list-item">' +
						'<div class="track-info">' +
							'<div>' + (i + 1) + '. <a href="' + escapeHtml(t.trackUri) + '" target="_blank" class="track-name-link">' + escapeHtml(t.trackName) + '</a></div>' +
							'<div class="track-artist">' + escapeHtml(t.artist) + '</div>' +
						'</div>' +
						'<div class="track-score">' + (t.valence * 100).toFixed(1) + '%</div>' +
					'</div>'
				).join('');
			}
			} catch (error) {
				console.error('Error initializing charts:', error);
			}
		}

		// Wait for ApexCharts to load
		function waitForApexCharts(callback, maxAttempts = 50) {
			let attempts = 0;
			const checkApexCharts = () => {
				if (typeof ApexCharts !== 'undefined') {
					callback();
				} else if (attempts < maxAttempts) {
					attempts++;
					setTimeout(checkApexCharts, 100);
				} else {
					console.error('ApexCharts failed to load');
					// Show error message
					document.querySelectorAll('.chart-wrapper').forEach(el => {
						if (!el.querySelector('canvas') && !el.querySelector('svg')) {
							el.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Chart failed to load. Please refresh the page.</p>';
						}
					});
				}
			};
			checkApexCharts();
		}

		// Smooth scroll animations for chart containers
		function animateChartsOnScroll() {
			const chartContainers = document.querySelectorAll('.chart-container');
			const chartObserver = new IntersectionObserver((entries) => {
				entries.forEach((entry, index) => {
					if (entry.isIntersecting) {
						setTimeout(() => {
							entry.target.style.opacity = '0';
							entry.target.style.transform = 'translateY(20px)';
							entry.target.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
							setTimeout(() => {
								entry.target.style.opacity = '1';
								entry.target.style.transform = 'translateY(0)';
							}, 50);
						}, index * 100);
						chartObserver.unobserve(entry.target);
					}
				});
			}, { threshold: 0.1 });
			
			chartContainers.forEach(container => {
				chartObserver.observe(container);
			});
		}
		
		// Event listeners
		document.addEventListener('DOMContentLoaded', () => {
			// Sort on header click
			document.querySelectorAll('th.sortable').forEach((th, idx) => {
				th.addEventListener('click', () => sortTable(idx));
			});

			// Filter on input
			document.querySelectorAll('.filter-input').forEach(input => {
				input.addEventListener('input', filterTable);
			});
			
			// Initialize scroll animations
			animateChartsOnScroll();

			// Initialize charts after DOM is ready and ApexCharts is loaded
			waitForApexCharts(() => {
				try {
					initializeCharts();
				} catch (error) {
					console.error('Error initializing charts:', error);
					document.querySelectorAll('.chart-wrapper').forEach(el => {
						if (!el.querySelector('canvas') && !el.querySelector('svg')) {
							el.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">Error loading chart. Check console for details.</p>';
						}
					});
				}
			});
		});
	</script>
	<footer class="main-footer" style="background: var(--bg-elevated); border-top: 1px solid rgba(255, 255, 255, 0.05); padding: var(--space-xl) 0; margin-top: var(--space-4xl);">
		<div class="footer-content" style="max-width: 1400px; margin: 0 auto; padding: 0 var(--space-xl); text-align: center;">
			<p class="footer-text" style="font-size: var(--text-base); color: var(--text-secondary); margin-bottom: var(--space-sm); display: flex; align-items: center; justify-content: center; gap: var(--space-sm); flex-wrap: wrap;">
				<span style="color: var(--text-primary); font-weight: var(--font-weight-semibold);">Nexporify - Open Source Music Analytics</span>
				<a href="https://github.com/visheshvs/exportify" target="_blank" rel="noopener" style="color: var(--accent-primary); text-decoration: none; transition: color 0.3s ease;">View on GitHub</a>
			</p>
			<p class="footer-credit" style="font-size: var(--text-sm); color: var(--text-tertiary);">
				Based on original work by <a href="https://github.com/pavelkomarov/exportify" target="_blank" rel="noopener" style="color: var(--accent-primary); text-decoration: none; transition: color 0.3s ease;">pavelkomarov/exportify</a>
			</p>
		</div>
	</footer>
</body>
</html>`
	},

	// Helper function to escape HTML
	escapeHtml(text) {
		if (!text) return ''
		let map = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#039;'
		}
		return text.toString().replace(/[&<>"']/g, m => map[m])
	}
}

// runs when the page loads
onload = async () => {
	let code = new URLSearchParams(location.search).get('code') // try to snag a code out of the url, in case this is after authorize()
	if (code) {
		// Get rid of the ugly code string from the browser bar, maintaining subdirectory path
		let cleanPath = location.pathname.split('?')[0].split('#')[0]; // Remove query and hash
		history.replaceState({}, '', cleanPath) // Maintain subdirectory path

		// Get full redirect URI including path (for GitHub Pages subdirectory support)
		let redirectUri = location.origin + location.pathname.replace(/\/$/, ''); // Remove trailing slash
		let response = await fetch("https://accounts.spotify.com/api/token", { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: new URLSearchParams({client_id: "d07d8c2ddb3646d4b4fb3781ffc6d2bc", grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
				code_verifier: localStorage.getItem('code_verifier')}) }) // POST to get the access token, then fish it out of the response body
		localStorage.setItem('access_token', (await response.json()).access_token) // https://stackoverflow.com/questions/59555534/why-is-json-asynchronous
		localStorage.setItem('access_token_timestamp', Date.now())
	}
	if (localStorage.getItem('access_token') && Date.now() - localStorage.getItem('access_token_timestamp') < 3600000) {
		if (loginButton) loginButton.style.display = 'none' // When logged in, make the login button invisible
		if (logoutContainer) logoutContainer.innerHTML = '<button id="logoutButton" class="logout-btn btn" onclick="utils.logout()">Log Out</button>' // Add a logout button by modifying the HTML
		ReactDOM.render(React.createElement(PlaylistTable), playlistsContainer) // Create table and put it in the playlistsContainer	
	}
}
