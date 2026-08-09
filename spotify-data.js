/**
 * Spotify Extended Streaming History explorer
 * Parses JSON exports, aggregates stats, renders charts, exports Excel.
 * All processing stays in the browser.
 */
(function (global) {
	'use strict';

	const SAMPLE_FILES = [
		'data/Streaming_History_Audio_2025.json',
		'data/Streaming_History_Audio_2025_1.json',
		'data/Streaming_History_Video_2025.json'
	];

	const PAGE_SIZE = 50;
	const TOP_N = 15;
	const SHORT_PLAY_MS = 30000;

	const CHART_COLORS = {
		primary: '#1DB954',
		blue: '#00D4FF',
		magenta: '#FF00E5',
		amber: '#FFB800',
		purple: '#8B5CF6',
		text: '#FFFFFF',
		muted: 'rgba(255, 255, 255, 0.5)',
		grid: 'rgba(255, 255, 255, 0.08)'
	};

	const state = {
		allRecords: [],
		filtered: [],
		filters: {
			dateFrom: '',
			dateTo: '',
			contentType: 'all',
			platform: 'all',
			medium: 'all',
			excludeSkips: false
		},
		page: 0,
		charts: {}
	};

	// ---------- helpers ----------

	function pad2(n) {
		return String(n).padStart(2, '0');
	}

	function toDateInputValue(d) {
		if (!d || isNaN(d.getTime())) return '';
		return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
	}

	function formatHours(ms) {
		const h = ms / 3600000;
		if (h >= 100) return h.toFixed(0);
		if (h >= 10) return h.toFixed(1);
		return h.toFixed(2);
	}

	function formatDuration(ms) {
		const totalSec = Math.floor((ms || 0) / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return m + ':' + pad2(s);
	}

	function formatTimestamp(iso) {
		if (!iso) return '';
		try {
			const d = new Date(iso);
			return d.toLocaleString(undefined, {
				year: 'numeric', month: 'short', day: 'numeric',
				hour: '2-digit', minute: '2-digit'
			});
		} catch (e) {
			return iso;
		}
	}

	function escapeHtml(str) {
		return String(str == null ? '' : str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function inferMediumFromFilename(name) {
		const lower = (name || '').toLowerCase();
		if (lower.includes('video')) return 'video';
		if (lower.includes('audio')) return 'audio';
		return 'unknown';
	}

	function classifyContent(raw) {
		if (raw.audiobook_title || raw.audiobook_uri || raw.audiobook_chapter_uri) return 'audiobook';
		if (raw.spotify_episode_uri || raw.episode_name || raw.episode_show_name) return 'podcast';
		if (raw.spotify_track_uri || raw.master_metadata_track_name) return 'music';
		return 'unknown';
	}

	function showStatus(message, type) {
		const el = document.getElementById('spotifyDataUploadStatus');
		if (!el) return;
		el.className = 'upload-status ' + (type || 'processing');
		el.style.display = 'block';
		el.textContent = message;
	}

	function setExplorerVisible(visible) {
		const el = document.getElementById('explorerSection');
		if (el) el.hidden = !visible;
		const exportBtn = document.getElementById('exportExcelBtn');
		if (exportBtn) exportBtn.disabled = !visible;
	}

	// ---------- parse / normalize ----------

	function normalizeRecord(raw, sourceFile) {
		const ts = raw.ts || '';
		const date = ts ? new Date(ts) : null;
		const contentType = classifyContent(raw);
		const msPlayed = typeof raw.ms_played === 'number' ? raw.ms_played : 0;

		let title = '';
		let creator = '';
		let album = '';
		let uri = '';

		if (contentType === 'podcast') {
			title = raw.episode_name || '';
			creator = raw.episode_show_name || '';
			uri = raw.spotify_episode_uri || '';
		} else if (contentType === 'audiobook') {
			title = raw.audiobook_chapter_title || raw.audiobook_title || '';
			creator = raw.audiobook_title || '';
			uri = raw.audiobook_chapter_uri || raw.audiobook_uri || '';
		} else {
			title = raw.master_metadata_track_name || '';
			creator = raw.master_metadata_album_artist_name || '';
			album = raw.master_metadata_album_album_name || '';
			uri = raw.spotify_track_uri || '';
		}

		const skipped = raw.skipped === true;
		const looksLikeSkip = skipped || (msPlayed > 0 && msPlayed < SHORT_PLAY_MS);

		return {
			ts: ts,
			date: date && !isNaN(date.getTime()) ? date : null,
			platform: raw.platform || 'unknown',
			ms_played: msPlayed,
			played_minutes: msPlayed / 60000,
			conn_country: raw.conn_country || '',
			title: title || '(unknown)',
			creator: creator || '(unknown)',
			album: album || '',
			uri: uri || '',
			spotify_track_uri: raw.spotify_track_uri || null,
			spotify_episode_uri: raw.spotify_episode_uri || null,
			content_type: contentType,
			stream_medium: inferMediumFromFilename(sourceFile),
			reason_start: raw.reason_start || '',
			reason_end: raw.reason_end || '',
			shuffle: raw.shuffle === true,
			skipped: skipped,
			looks_like_skip: looksLikeSkip,
			offline: raw.offline === true,
			offline_timestamp: raw.offline_timestamp != null ? raw.offline_timestamp : null,
			incognito_mode: raw.incognito_mode === true,
			source_file: sourceFile || ''
		};
	}

	function isStreamingArray(data) {
		if (!Array.isArray(data) || data.length === 0) return false;
		const sample = data.find(function (r) { return r && typeof r === 'object'; });
		if (!sample) return false;
		return 'ts' in sample && ('ms_played' in sample || 'msPlayed' in sample);
	}

	function parseJsonText(text, sourceFile) {
		let data;
		try {
			data = JSON.parse(text);
		} catch (e) {
			throw new Error('Invalid JSON in ' + sourceFile + ': ' + e.message);
		}
		if (!isStreamingArray(data)) {
			throw new Error(
				sourceFile + ' does not look like Extended Streaming History (expected an array of stream objects with ts / ms_played).'
			);
		}
		return data.map(function (raw) {
			return normalizeRecord(raw, sourceFile);
		});
	}

	async function parseFile(file) {
		const text = await file.text();
		return parseJsonText(text, file.name);
	}

	async function parseStreamingFiles(files) {
		const list = Array.from(files || []).filter(function (f) {
			return f.name.toLowerCase().endsWith('.json');
		});
		if (!list.length) {
			throw new Error('Please select one or more .json streaming history files.');
		}

		const all = [];
		const errors = [];
		for (let i = 0; i < list.length; i++) {
			try {
				const records = await parseFile(list[i]);
				all.push.apply(all, records);
			} catch (e) {
				errors.push(e.message);
			}
		}
		if (!all.length) {
			throw new Error(errors.join(' ') || 'No valid streaming records found.');
		}
		all.sort(function (a, b) {
			const ta = a.date ? a.date.getTime() : 0;
			const tb = b.date ? b.date.getTime() : 0;
			return ta - tb;
		});
		return { records: all, errors: errors };
	}

	async function loadSampleData() {
		const all = [];
		const errors = [];
		for (let i = 0; i < SAMPLE_FILES.length; i++) {
			const path = SAMPLE_FILES[i];
			try {
				const res = await fetch(path);
				if (!res.ok) throw new Error('HTTP ' + res.status);
				const text = await res.text();
				const name = path.split('/').pop();
				all.push.apply(all, parseJsonText(text, name));
			} catch (e) {
				errors.push(path + ': ' + e.message);
			}
		}
		if (!all.length) {
			throw new Error(
				'Could not load sample files from data/. Place Streaming_History_*.json there and serve the site over HTTP, or upload files instead. ' +
				errors.join(' ')
			);
		}
		all.sort(function (a, b) {
			const ta = a.date ? a.date.getTime() : 0;
			const tb = b.date ? b.date.getTime() : 0;
			return ta - tb;
		});
		return { records: all, errors: errors };
	}

	// ---------- filter / stats ----------

	function filterRecords(records, filters) {
		const from = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00.000Z') : null;
		const to = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59.999Z') : null;

		return records.filter(function (r) {
			if (from && r.date && r.date < from) return false;
			if (to && r.date && r.date > to) return false;
			if (filters.contentType !== 'all' && r.content_type !== filters.contentType) return false;
			if (filters.platform !== 'all' && r.platform !== filters.platform) return false;
			if (filters.medium !== 'all' && r.stream_medium !== filters.medium) return false;
			if (filters.excludeSkips && r.looks_like_skip) return false;
			return true;
		});
	}

	function bumpMap(map, key, plays, minutes) {
		if (!key) key = '(unknown)';
		if (!map[key]) map[key] = { name: key, plays: 0, minutes: 0 };
		map[key].plays += plays;
		map[key].minutes += minutes;
	}

	function topFromMap(map, n) {
		return Object.values(map)
			.sort(function (a, b) { return b.minutes - a.minutes || b.plays - a.plays; })
			.slice(0, n);
	}

	function computeStats(records) {
		const artists = {};
		const tracks = {};
		const shows = {};
		const albums = {};
		const platforms = {};
		const countries = {};
		const contentTypes = {};
		const media = {};
		const reasonStart = {};
		const reasonEnd = {};
		const daily = {};

		let totalMs = 0;
		let skippedCount = 0;
		let minDate = null;
		let maxDate = null;
		const uniqueArtists = new Set();
		const uniqueTracks = new Set();

		for (let i = 0; i < records.length; i++) {
			const r = records[i];
			totalMs += r.ms_played;
			if (r.skipped || r.looks_like_skip) skippedCount++;
			if (r.date) {
				if (!minDate || r.date < minDate) minDate = r.date;
				if (!maxDate || r.date > maxDate) maxDate = r.date;
				const day = toDateInputValue(r.date);
				if (!daily[day]) daily[day] = { date: day, plays: 0, minutes: 0, ms: 0 };
				daily[day].plays += 1;
				daily[day].minutes += r.played_minutes;
				daily[day].ms += r.ms_played;
			}

			platforms[r.platform] = (platforms[r.platform] || 0) + 1;
			if (r.conn_country) countries[r.conn_country] = (countries[r.conn_country] || 0) + 1;
			contentTypes[r.content_type] = (contentTypes[r.content_type] || 0) + 1;
			media[r.stream_medium] = (media[r.stream_medium] || 0) + 1;
			if (r.reason_start) reasonStart[r.reason_start] = (reasonStart[r.reason_start] || 0) + 1;
			if (r.reason_end) reasonEnd[r.reason_end] = (reasonEnd[r.reason_end] || 0) + 1;

			if (r.content_type === 'music') {
				uniqueArtists.add(r.creator);
				uniqueTracks.add(r.uri || (r.title + '|' + r.creator));
				bumpMap(artists, r.creator, 1, r.played_minutes);
				bumpMap(tracks, r.title + ' — ' + r.creator, 1, r.played_minutes);
				if (r.album) bumpMap(albums, r.album + ' — ' + r.creator, 1, r.played_minutes);
			} else if (r.content_type === 'podcast') {
				bumpMap(shows, r.creator, 1, r.played_minutes);
			}
		}

		const dailySeries = Object.keys(daily).sort().map(function (k) { return daily[k]; });

		return {
			totalPlays: records.length,
			totalMs: totalMs,
			totalHours: totalMs / 3600000,
			skipRate: records.length ? skippedCount / records.length : 0,
			skippedCount: skippedCount,
			uniqueArtists: uniqueArtists.size,
			uniqueTracks: uniqueTracks.size,
			minDate: minDate,
			maxDate: maxDate,
			topArtists: topFromMap(artists, TOP_N),
			topTracks: topFromMap(tracks, TOP_N).map(function (t) {
				const parts = t.name.split(' — ');
				return {
					name: parts[0] || t.name,
					artist: parts.slice(1).join(' — ') || '',
					plays: t.plays,
					minutes: t.minutes,
					label: t.name
				};
			}),
			topShows: topFromMap(shows, TOP_N),
			topAlbums: topFromMap(albums, TOP_N),
			platforms: platforms,
			countries: countries,
			contentTypes: contentTypes,
			media: media,
			reasonStart: reasonStart,
			reasonEnd: reasonEnd,
			daily: dailySeries
		};
	}

	function getFilterOptions(records) {
		const platforms = new Set();
		const media = new Set();
		const types = new Set();
		let minDate = null;
		let maxDate = null;
		for (let i = 0; i < records.length; i++) {
			const r = records[i];
			platforms.add(r.platform);
			media.add(r.stream_medium);
			types.add(r.content_type);
			if (r.date) {
				if (!minDate || r.date < minDate) minDate = r.date;
				if (!maxDate || r.date > maxDate) maxDate = r.date;
			}
		}
		return {
			platforms: Array.from(platforms).sort(),
			media: Array.from(media).sort(),
			contentTypes: Array.from(types).sort(),
			minDate: minDate,
			maxDate: maxDate
		};
	}

	// ---------- UI: filters / stats / table ----------

	function populateFilterControls(options) {
		const platformSelect = document.getElementById('filterPlatform');
		const typeSelect = document.getElementById('filterContentType');
		const mediumSelect = document.getElementById('filterMedium');
		const dateFrom = document.getElementById('filterDateFrom');
		const dateTo = document.getElementById('filterDateTo');

		function fillSelect(select, values, allLabel) {
			if (!select) return;
			const current = select.value;
			select.innerHTML = '';
			const allOpt = document.createElement('option');
			allOpt.value = 'all';
			allOpt.textContent = allLabel;
			select.appendChild(allOpt);
			values.forEach(function (v) {
				const opt = document.createElement('option');
				opt.value = v;
				opt.textContent = v;
				select.appendChild(opt);
			});
			if (Array.from(select.options).some(function (o) { return o.value === current; })) {
				select.value = current;
			}
		}

		fillSelect(platformSelect, options.platforms, 'All platforms');
		fillSelect(typeSelect, options.contentTypes, 'All types');
		fillSelect(mediumSelect, options.media, 'All media');

		if (dateFrom && options.minDate) {
			dateFrom.min = toDateInputValue(options.minDate);
			dateFrom.max = toDateInputValue(options.maxDate);
			if (!dateFrom.value) dateFrom.value = toDateInputValue(options.minDate);
		}
		if (dateTo && options.maxDate) {
			dateTo.min = toDateInputValue(options.minDate);
			dateTo.max = toDateInputValue(options.maxDate);
			if (!dateTo.value) dateTo.value = toDateInputValue(options.maxDate);
		}

		state.filters.dateFrom = dateFrom ? dateFrom.value : '';
		state.filters.dateTo = dateTo ? dateTo.value : '';
	}

	function readFiltersFromDom() {
		state.filters.dateFrom = (document.getElementById('filterDateFrom') || {}).value || '';
		state.filters.dateTo = (document.getElementById('filterDateTo') || {}).value || '';
		state.filters.contentType = (document.getElementById('filterContentType') || {}).value || 'all';
		state.filters.platform = (document.getElementById('filterPlatform') || {}).value || 'all';
		state.filters.medium = (document.getElementById('filterMedium') || {}).value || 'all';
		state.filters.excludeSkips = !!(document.getElementById('filterExcludeSkips') || {}).checked;
	}

	function renderStats(stats) {
		const set = function (id, text) {
			const el = document.getElementById(id);
			if (el) el.textContent = text;
		};
		set('statPlays', stats.totalPlays.toLocaleString());
		set('statHours', formatHours(stats.totalMs) + ' h');
		set('statArtists', stats.uniqueArtists.toLocaleString());
		set('statTracks', stats.uniqueTracks.toLocaleString());
		set('statSkipRate', (stats.skipRate * 100).toFixed(1) + '%');
		const span = (stats.minDate && stats.maxDate)
			? toDateInputValue(stats.minDate) + ' → ' + toDateInputValue(stats.maxDate)
			: '—';
		set('statDateSpan', span);
		set('statFilteredCount', stats.totalPlays.toLocaleString() + ' plays in view');
	}

	function renderPlayLog() {
		const tbody = document.getElementById('playLogBody');
		const info = document.getElementById('playLogInfo');
		const prevBtn = document.getElementById('playLogPrev');
		const nextBtn = document.getElementById('playLogNext');
		if (!tbody) return;

		const total = state.filtered.length;
		const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
		if (state.page >= totalPages) state.page = totalPages - 1;
		if (state.page < 0) state.page = 0;

		const start = state.page * PAGE_SIZE;
		const pageRows = state.filtered.slice().reverse().slice(start, start + PAGE_SIZE);

		tbody.innerHTML = pageRows.map(function (r) {
			return '<tr>' +
				'<td>' + escapeHtml(formatTimestamp(r.ts)) + '</td>' +
				'<td>' + escapeHtml(r.title) + '</td>' +
				'<td>' + escapeHtml(r.creator) + '</td>' +
				'<td><span class="play-type-badge play-type-' + escapeHtml(r.content_type) + '">' +
					escapeHtml(r.content_type) + '</span></td>' +
				'<td>' + escapeHtml(formatDuration(r.ms_played)) + '</td>' +
				'<td>' + escapeHtml(r.platform) + '</td>' +
				'<td>' + (r.skipped ? 'Yes' : 'No') + '</td>' +
				'</tr>';
		}).join('');

		if (info) {
			const showingFrom = total ? start + 1 : 0;
			const showingTo = Math.min(start + PAGE_SIZE, total);
			info.textContent = 'Showing ' + showingFrom + '–' + showingTo + ' of ' + total.toLocaleString() +
				' (newest first) · page ' + (state.page + 1) + '/' + totalPages;
		}
		if (prevBtn) prevBtn.disabled = state.page <= 0;
		if (nextBtn) nextBtn.disabled = state.page >= totalPages - 1;
	}

	// ---------- charts ----------

	function destroyCharts() {
		Object.keys(state.charts).forEach(function (key) {
			try { state.charts[key].destroy(); } catch (e) { /* ignore */ }
		});
		state.charts = {};
	}

	function baseChartOptions() {
		return {
			chart: {
				toolbar: { show: false },
				background: 'transparent',
				foreColor: CHART_COLORS.muted,
				fontFamily: 'Inter, sans-serif'
			},
			theme: { mode: 'dark' },
			grid: { borderColor: CHART_COLORS.grid },
			tooltip: { theme: 'dark' }
		};
	}

	function renderCharts(stats) {
		if (typeof ApexCharts === 'undefined') return;
		destroyCharts();

		const daily = stats.daily;
		const useWeekly = daily.length > 90;
		let timeLabels = [];
		let timeMinutes = [];

		if (useWeekly && daily.length) {
			const weeks = {};
			daily.forEach(function (d) {
				const dt = new Date(d.date + 'T00:00:00Z');
				const day = dt.getUTCDay();
				const mondayOffset = (day + 6) % 7;
				dt.setUTCDate(dt.getUTCDate() - mondayOffset);
				const key = toDateInputValue(dt);
				if (!weeks[key]) weeks[key] = 0;
				weeks[key] += d.minutes;
			});
			timeLabels = Object.keys(weeks).sort();
			timeMinutes = timeLabels.map(function (k) { return Math.round(weeks[k] * 10) / 10; });
		} else {
			timeLabels = daily.map(function (d) { return d.date; });
			timeMinutes = daily.map(function (d) { return Math.round(d.minutes * 10) / 10; });
		}

		const timeEl = document.getElementById('chartListeningOverTime');
		if (timeEl) {
			const titleEl = document.getElementById('chartListeningOverTimeTitle');
			if (titleEl) titleEl.textContent = useWeekly ? 'Listening time (weekly minutes)' : 'Listening time (daily minutes)';
			state.charts.time = new ApexCharts(timeEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'area', height: 280 }),
				series: [{ name: 'Minutes', data: timeMinutes }],
				xaxis: { categories: timeLabels, labels: { show: timeLabels.length < 40, rotate: -45 } },
				yaxis: { title: { text: 'Minutes' }, labels: { formatter: function (v) { return Math.round(v); } } },
				stroke: { curve: 'smooth', width: 2 },
				fill: {
					type: 'gradient',
					gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 90, 100] }
				},
				colors: [CHART_COLORS.primary],
				dataLabels: { enabled: false }
			}));
			state.charts.time.render();
		}

		const artistEl = document.getElementById('chartTopArtists');
		if (artistEl) {
			const artists = stats.topArtists.slice(0, 10).reverse();
			state.charts.artists = new ApexCharts(artistEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'bar', height: 320 }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{ name: 'Minutes', data: artists.map(function (a) { return Math.round(a.minutes); }) }],
				xaxis: { categories: artists.map(function (a) { return a.name; }) },
				colors: [CHART_COLORS.blue],
				dataLabels: { enabled: false }
			}));
			state.charts.artists.render();
		}

		const trackEl = document.getElementById('chartTopTracks');
		if (trackEl) {
			const tracks = stats.topTracks.slice(0, 10).reverse();
			state.charts.tracks = new ApexCharts(trackEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'bar', height: 320 }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{ name: 'Minutes', data: tracks.map(function (t) { return Math.round(t.minutes); }) }],
				xaxis: { categories: tracks.map(function (t) { return t.name; }) },
				colors: [CHART_COLORS.magenta],
				dataLabels: { enabled: false }
			}));
			state.charts.tracks.render();
		}

		const typeEl = document.getElementById('chartContentType');
		if (typeEl) {
			const labels = Object.keys(stats.contentTypes);
			const values = labels.map(function (k) { return stats.contentTypes[k]; });
			state.charts.types = new ApexCharts(typeEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'donut', height: 300 }),
				series: values,
				labels: labels,
				colors: [CHART_COLORS.primary, CHART_COLORS.blue, CHART_COLORS.amber, CHART_COLORS.purple],
				legend: { position: 'bottom' },
				dataLabels: { enabled: true }
			}));
			state.charts.types.render();
		}

		const platformEl = document.getElementById('chartPlatforms');
		if (platformEl) {
			const labels = Object.keys(stats.platforms).sort(function (a, b) {
				return stats.platforms[b] - stats.platforms[a];
			});
			state.charts.platforms = new ApexCharts(platformEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'bar', height: 300 }),
				series: [{ name: 'Plays', data: labels.map(function (k) { return stats.platforms[k]; }) }],
				xaxis: { categories: labels },
				colors: [CHART_COLORS.amber],
				dataLabels: { enabled: false }
			}));
			state.charts.platforms.render();
		}

		const reasonEl = document.getElementById('chartReasonEnd');
		if (reasonEl) {
			const entries = Object.entries(stats.reasonEnd).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
			state.charts.reason = new ApexCharts(reasonEl, Object.assign({}, baseChartOptions(), {
				chart: Object.assign({}, baseChartOptions().chart, { type: 'bar', height: 300 }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{ name: 'Plays', data: entries.map(function (e) { return e[1]; }).reverse() }],
				xaxis: { categories: entries.map(function (e) { return e[0]; }).reverse() },
				colors: [CHART_COLORS.purple],
				dataLabels: { enabled: false }
			}));
			state.charts.reason.render();
		}
	}

	// ---------- excel export ----------

	function exportExcel() {
		if (typeof XLSX === 'undefined') {
			showStatus('Excel library failed to load. Check your network and refresh.', 'error');
			return;
		}
		if (!state.filtered.length) {
			showStatus('Nothing to export — load data first.', 'error');
			return;
		}

		const stats = computeStats(state.filtered);
		const plays = state.filtered.map(function (r) {
			return {
				timestamp: r.ts,
				title: r.title,
				artist_or_show: r.creator,
				album: r.album,
				content_type: r.content_type,
				medium: r.stream_medium,
				ms_played: r.ms_played,
				minutes: Math.round(r.played_minutes * 1000) / 1000,
				platform: r.platform,
				country: r.conn_country,
				reason_start: r.reason_start,
				reason_end: r.reason_end,
				shuffle: r.shuffle,
				skipped: r.skipped,
				offline: r.offline,
				incognito: r.incognito_mode,
				uri: r.uri
			};
		});

		const summary = [
			{ metric: 'Total plays', value: stats.totalPlays },
			{ metric: 'Total hours', value: Math.round(stats.totalHours * 100) / 100 },
			{ metric: 'Unique artists (music)', value: stats.uniqueArtists },
			{ metric: 'Unique tracks (music)', value: stats.uniqueTracks },
			{ metric: 'Skip rate', value: (stats.skipRate * 100).toFixed(2) + '%' },
			{ metric: 'Date from', value: stats.minDate ? stats.minDate.toISOString() : '' },
			{ metric: 'Date to', value: stats.maxDate ? stats.maxDate.toISOString() : '' },
			{ metric: 'Filters content_type', value: state.filters.contentType },
			{ metric: 'Filters platform', value: state.filters.platform },
			{ metric: 'Filters medium', value: state.filters.medium },
			{ metric: 'Filters exclude_skips', value: state.filters.excludeSkips },
			{ metric: 'Note', value: 'IP addresses omitted from export for privacy' }
		];

		const topArtists = stats.topArtists.map(function (a) {
			return { artist: a.name, plays: a.plays, minutes: Math.round(a.minutes * 10) / 10 };
		});
		const topTracks = stats.topTracks.map(function (t) {
			return {
				track: t.name,
				artist: t.artist,
				plays: t.plays,
				minutes: Math.round(t.minutes * 10) / 10
			};
		});
		const daily = stats.daily.map(function (d) {
			return {
				date: d.date,
				plays: d.plays,
				minutes: Math.round(d.minutes * 10) / 10
			};
		});

		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plays), 'Plays');
		XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
		XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topArtists), 'Top Artists');
		XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topTracks), 'Top Tracks');
		XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), 'Daily');

		const today = toDateInputValue(new Date());
		const filename = 'spotify-listening-' + today + '.xlsx';
		const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
		const blob = new Blob([wbout], { type: 'application/octet-stream' });

		if (typeof saveAs === 'function') {
			saveAs(blob, filename);
		} else {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
		}
		showStatus('Exported ' + filename + ' (' + plays.length.toLocaleString() + ' plays).', 'success');
	}

	// ---------- orchestration ----------

	function applyFiltersAndRender() {
		readFiltersFromDom();
		state.filtered = filterRecords(state.allRecords, state.filters);
		state.page = 0;
		const stats = computeStats(state.filtered);
		renderStats(stats);
		renderCharts(stats);
		renderPlayLog();
		setExplorerVisible(true);
	}

	async function ingestResult(result) {
		state.allRecords = result.records;
		const options = getFilterOptions(state.allRecords);
		populateFilterControls(options);
		applyFiltersAndRender();

		let msg = 'Loaded ' + state.allRecords.length.toLocaleString() + ' streams.';
		if (result.errors && result.errors.length) {
			msg += ' Warnings: ' + result.errors.join('; ');
			showStatus(msg, 'processing');
		} else {
			showStatus(msg, 'success');
		}
	}

	async function handleUploadedFiles(fileList) {
		showStatus('Parsing JSON…', 'processing');
		try {
			const result = await parseStreamingFiles(fileList);
			await ingestResult(result);
		} catch (e) {
			showStatus(e.message || String(e), 'error');
			setExplorerVisible(false);
		}
	}

	async function handleLoadSample() {
		showStatus('Loading sample data from data/…', 'processing');
		const btn = document.getElementById('loadSampleBtn');
		if (btn) btn.disabled = true;
		try {
			const result = await loadSampleData();
			await ingestResult(result);
		} catch (e) {
			showStatus(e.message || String(e), 'error');
			setExplorerVisible(false);
		} finally {
			if (btn) btn.disabled = false;
		}
	}

	function bindUi() {
		const fileInput = document.getElementById('spotifyDataUpload');
		const uploadZone = document.getElementById('spotifyDataUploadZone');
		const loadSampleBtn = document.getElementById('loadSampleBtn');
		const exportBtn = document.getElementById('exportExcelBtn');
		const applyBtn = document.getElementById('applyFiltersBtn');
		const prevBtn = document.getElementById('playLogPrev');
		const nextBtn = document.getElementById('playLogNext');

		if (fileInput) {
			fileInput.addEventListener('change', function (e) {
				if (e.target.files && e.target.files.length) handleUploadedFiles(e.target.files);
			});
		}

		if (uploadZone) {
			uploadZone.addEventListener('dragover', function (e) {
				e.preventDefault();
				uploadZone.classList.add('dragover');
			});
			uploadZone.addEventListener('dragleave', function (e) {
				e.preventDefault();
				uploadZone.classList.remove('dragover');
			});
			uploadZone.addEventListener('drop', function (e) {
				e.preventDefault();
				uploadZone.classList.remove('dragover');
				if (e.dataTransfer.files && e.dataTransfer.files.length) {
					handleUploadedFiles(e.dataTransfer.files);
				}
			});
		}

		if (loadSampleBtn) loadSampleBtn.addEventListener('click', handleLoadSample);
		if (exportBtn) exportBtn.addEventListener('click', exportExcel);
		if (applyBtn) applyBtn.addEventListener('click', applyFiltersAndRender);

		['filterDateFrom', 'filterDateTo', 'filterContentType', 'filterPlatform', 'filterMedium', 'filterExcludeSkips']
			.forEach(function (id) {
				const el = document.getElementById(id);
				if (el) el.addEventListener('change', applyFiltersAndRender);
			});

		if (prevBtn) {
			prevBtn.addEventListener('click', function () {
				state.page -= 1;
				renderPlayLog();
			});
		}
		if (nextBtn) {
			nextBtn.addEventListener('click', function () {
				state.page += 1;
				renderPlayLog();
			});
		}
	}

	function init() {
		bindUi();
		setExplorerVisible(false);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	global.SpotifyDataExplorer = {
		parseStreamingFiles: parseStreamingFiles,
		loadSampleData: loadSampleData,
		filterRecords: filterRecords,
		computeStats: computeStats,
		exportExcel: exportExcel
	};
})(typeof window !== 'undefined' ? window : this);
