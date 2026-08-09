/**
 * Music Insights Chapters — derived analytics + chart renderers
 * for Extended Streaming History. Pure client-side.
 */
(function (global) {
	'use strict';

	var SESSION_GAP_MS = 30 * 60 * 1000;
	var WARMUP_DAYS = 30;
	var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	var COLORS = {
		primary: '#1DB954',
		blue: '#00D4FF',
		magenta: '#FF00E5',
		amber: '#FFB800',
		purple: '#8B5CF6',
		muted: 'rgba(255, 255, 255, 0.5)',
		grid: 'rgba(255, 255, 255, 0.08)',
		heat: ['#0d1f12', '#134e2a', '#1aa34a', '#1DB954', '#1ed760']
	};

	var tabCharts = {};
	var activeTab = 'overview';

	function pad2(n) {
		return String(n).padStart(2, '0');
	}

	function round1(n) {
		return Math.round(n * 10) / 10;
	}

	function formatMinutes(m) {
		return round1(m || 0).toLocaleString();
	}

	function escapeHtml(str) {
		return String(str == null ? '' : str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function median(sorted) {
		if (!sorted.length) return 0;
		var mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	function percentile(sorted, p) {
		if (!sorted.length) return 0;
		var idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
		return sorted[idx];
	}

	// ---------- timezone-aware date helpers ----------

	function getParts(date, tzMode) {
		if (!date || isNaN(date.getTime())) return null;
		if (tzMode === 'utc') {
			return {
				year: date.getUTCFullYear(),
				month: date.getUTCMonth(),
				day: date.getUTCDate(),
				hour: date.getUTCHours(),
				weekday: date.getUTCDay()
			};
		}
		return {
			year: date.getFullYear(),
			month: date.getMonth(),
			day: date.getDate(),
			hour: date.getHours(),
			weekday: date.getDay()
		};
	}

	function getHour(date, tzMode) {
		var p = getParts(date, tzMode);
		return p ? p.hour : 0;
	}

	function getWeekday(date, tzMode) {
		var p = getParts(date, tzMode);
		return p ? p.weekday : 0;
	}

	function getDayKey(date, tzMode) {
		var p = getParts(date, tzMode);
		if (!p) return '';
		return p.year + '-' + pad2(p.month + 1) + '-' + pad2(p.day);
	}

	function getMonthKey(date, tzMode) {
		var p = getParts(date, tzMode);
		if (!p) return '';
		return p.year + '-' + pad2(p.month + 1);
	}

	function dayKeyToDate(key) {
		return new Date(key + 'T12:00:00Z');
	}

	function daysBetween(a, b) {
		return Math.round((b.getTime() - a.getTime()) / 86400000);
	}

	// ---------- core algorithms ----------

	function sessionize(records) {
		var sessions = [];
		var cur = null;
		var sorted = records.slice().filter(function (r) { return r.date; })
			.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

		for (var i = 0; i < sorted.length; i++) {
			var r = sorted[i];
			var end = r.date.getTime();
			var start = end - (r.ms_played || 0);
			if (!cur || start - cur.end > SESSION_GAP_MS) {
				cur = {
					start: start,
					end: end,
					plays: 0,
					ms: 0,
					minutes: 0
				};
				sessions.push(cur);
			}
			cur.end = Math.max(cur.end, end);
			cur.plays += 1;
			cur.ms += r.ms_played || 0;
			cur.minutes = cur.ms / 60000;
		}
		return sessions;
	}

	function computeGini(values) {
		var asc = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
		if (!asc.length) return 0;
		var total = asc.reduce(function (s, v) { return s + v; }, 0);
		if (!total) return 0;
		var g = 0;
		asc.forEach(function (v, i) {
			g += (2 * (i + 1) - asc.length - 1) * v;
		});
		return g / (asc.length * total);
	}

	function computeEntropy(values) {
		var pos = values.filter(function (v) { return v > 0; });
		if (!pos.length) return { entropy: 0, normalized: 0, max: 0 };
		var total = pos.reduce(function (s, v) { return s + v; }, 0);
		var H = 0;
		pos.forEach(function (v) {
			var p = v / total;
			H -= p * Math.log2(p);
		});
		var maxH = Math.log2(pos.length);
		return {
			entropy: H,
			normalized: maxH ? H / maxH : 0,
			max: maxH
		};
	}

	function artistsForHalf(minutesAscDesc) {
		var total = minutesAscDesc.reduce(function (s, v) { return s + v; }, 0);
		if (!total) return { count: 0, pct: 0 };
		var cum = 0;
		var i = 0;
		while (i < minutesAscDesc.length && cum < total * 0.5) {
			cum += minutesAscDesc[i];
			i++;
		}
		return { count: i, pct: (i / minutesAscDesc.length) * 100 };
	}

	// ---------- chapter computations ----------

	function computeFingerprint(records, tzMode) {
		var clock = [];
		var d, h;
		for (d = 0; d < 7; d++) {
			clock[d] = [];
			for (h = 0; h < 24; h++) clock[d][h] = 0;
		}

		var daily = {};
		var musicByHour = Array(24).fill(0);
		var podcastByHour = Array(24).fill(0);
		var i, r, dayKey, parts;

		for (i = 0; i < records.length; i++) {
			r = records[i];
			if (!r.date) continue;
			var mins = r.played_minutes || 0;
			var wd = getWeekday(r.date, tzMode);
			var hr = getHour(r.date, tzMode);
			clock[wd][hr] += mins;
			dayKey = getDayKey(r.date, tzMode);
			if (!daily[dayKey]) daily[dayKey] = 0;
			daily[dayKey] += mins;
			if (r.content_type === 'podcast') podcastByHour[hr] += mins;
			else if (r.content_type === 'music') musicByHour[hr] += mins;
		}

		var sessions = sessionize(records);
		var archetypes = { quick: 0, commute: 0, deep: 0 };
		var sessionMinutes = [];
		sessions.forEach(function (s) {
			sessionMinutes.push(s.minutes);
			if (s.minutes < 10) archetypes.quick++;
			else if (s.minutes < 40) archetypes.commute++;
			else archetypes.deep++;
		});
		sessionMinutes.sort(function (a, b) { return a - b; });

		var dayKeys = Object.keys(daily).sort();
		var streak = 1;
		var bestStreak = dayKeys.length ? 1 : 0;
		var curStreak = dayKeys.length ? 1 : 0;
		for (i = 1; i < dayKeys.length; i++) {
			var diff = daysBetween(dayKeyToDate(dayKeys[i - 1]), dayKeyToDate(dayKeys[i]));
			if (diff === 1) {
				curStreak++;
				if (curStreak > bestStreak) bestStreak = curStreak;
			} else {
				curStreak = 1;
			}
		}

		var peak = { v: 0, wd: 0, h: 0 };
		for (d = 0; d < 7; d++) {
			for (h = 0; h < 24; h++) {
				if (clock[d][h] > peak.v) peak = { v: clock[d][h], wd: d, h: h };
			}
		}

		var takeaway = sessions.length
			? dayKeys.length + ' active days · longest streak ' + bestStreak +
				' · ' + sessions.length.toLocaleString() + ' sessions (median ' +
				round1(median(sessionMinutes)) + ' min) · peak ' +
				DAY_NAMES[peak.wd] + ' ' + pad2(peak.h) + ':00'
			: 'Not enough data for a listening fingerprint.';

		return {
			takeaway: takeaway,
			tzMode: tzMode,
			clock: clock,
			daily: daily,
			dayKeys: dayKeys,
			activeDays: dayKeys.length,
			longestStreak: bestStreak,
			sessions: sessions,
			sessionMinutes: sessionMinutes,
			archetypes: archetypes,
			musicByHour: musicByHour,
			podcastByHour: podcastByHour,
			peak: peak,
			medianSession: median(sessionMinutes),
			p90Session: percentile(sessionMinutes, 0.9)
		};
	}

	function computeTaste(records, tzMode) {
		var music = records.filter(function (r) { return r.content_type === 'music'; });
		var artistMins = {};
		var firstArtist = {};
		var firstTrack = {};
		var monthly = {};
		var minDate = null;
		var i, r, a, t, mk, dk;

		for (i = 0; i < music.length; i++) {
			r = music[i];
			if (!r.date) continue;
			if (!minDate || r.date < minDate) minDate = r.date;
			a = r.creator || '(unknown)';
			t = r.uri || (r.title + '|' + a);
			artistMins[a] = (artistMins[a] || 0) + (r.played_minutes || 0);
			mk = getMonthKey(r.date, tzMode);
			if (!monthly[mk]) {
				monthly[mk] = {
					month: mk,
					plays: 0,
					newArtists: 0,
					newTracks: 0,
					freshMin: 0,
					totalMin: 0,
					inWarmup: false
				};
			}
			monthly[mk].plays++;
			monthly[mk].totalMin += r.played_minutes || 0;

			if (!firstArtist[a]) {
				firstArtist[a] = r.date;
				monthly[mk].newArtists++;
			}
			if (!firstTrack[t]) {
				firstTrack[t] = r.date;
				monthly[mk].newTracks++;
			}
			var firstT = firstTrack[t];
			if (firstT && (r.date - firstT) / 86400000 <= 30) {
				monthly[mk].freshMin += r.played_minutes || 0;
			}
		}

		var warmupEnd = minDate ? new Date(minDate.getTime() + WARMUP_DAYS * 86400000) : null;
		Object.keys(monthly).forEach(function (m) {
			var mid = new Date(m + '-15T12:00:00Z');
			monthly[m].inWarmup = !!(warmupEnd && mid < warmupEnd);
			monthly[m].noveltyPct = monthly[m].totalMin
				? (monthly[m].freshMin / monthly[m].totalMin) * 100
				: 0;
		});

		var minsDesc = Object.values(artistMins).sort(function (a, b) { return b - a; });
		var gini = computeGini(minsDesc);
		var entropy = computeEntropy(minsDesc);
		var half = artistsForHalf(minsDesc);
		var totalMin = minsDesc.reduce(function (s, v) { return s + v; }, 0);

		// Lorenz: share of artists (x) vs cumulative minutes (y), ascending
		var asc = minsDesc.slice().reverse();
		var lorenz = [{ x: 0, y: 0 }];
		var cum = 0;
		asc.forEach(function (v, idx) {
			cum += v;
			lorenz.push({
				x: ((idx + 1) / asc.length) * 100,
				y: totalMin ? (cum / totalMin) * 100 : 0
			});
		});

		var monthSeries = Object.keys(monthly).sort().map(function (k) { return monthly[k]; });

		var takeaway = minsDesc.length
			? half.count + ' artists (' + round1(half.pct) + '%) make up half your listening · Gini ' +
				gini.toFixed(2) + ' · exploration score ' + round1(entropy.normalized * 100) + '/100'
			: 'Not enough music plays for taste analysis.';

		return {
			takeaway: takeaway,
			artistCount: minsDesc.length,
			gini: gini,
			entropy: entropy,
			half: half,
			lorenz: lorenz,
			monthly: monthSeries,
			warmupEnd: warmupEnd,
			warmupDays: WARMUP_DAYS
		};
	}

	function computeArtists(records) {
		var music = records.filter(function (r) { return r.content_type === 'music'; });
		var map = {};
		var i, r, a, key;

		for (i = 0; i < music.length; i++) {
			r = music[i];
			a = r.creator || '(unknown)';
			if (!map[a]) {
				map[a] = {
					name: a,
					plays: 0,
					minutes: 0,
					first: r.date,
					last: r.date,
					tracks: {}
				};
			}
			map[a].plays++;
			map[a].minutes += r.played_minutes || 0;
			if (r.date) {
				if (!map[a].first || r.date < map[a].first) map[a].first = r.date;
				if (!map[a].last || r.date > map[a].last) map[a].last = r.date;
			}
			key = r.uri || r.title;
			if (key) map[a].tracks[key] = true;
		}

		var list = Object.values(map).map(function (v) {
			var span = (v.first && v.last) ? daysBetween(v.first, v.last) : 0;
			return {
				name: v.name,
				plays: v.plays,
				minutes: v.minutes,
				span: span,
				trackCount: Object.keys(v.tracks).length,
				first: v.first,
				last: v.last,
				kind: (span <= 30 && v.plays >= 20) ? 'fling'
					: (span > 300 && v.plays >= 30) ? 'loyal'
					: 'regular'
			};
		}).sort(function (a, b) { return b.minutes - a.minutes; });

		var flings = list.filter(function (a) { return a.kind === 'fling'; }).slice(0, 10);
		var loyal = list.filter(function (a) { return a.kind === 'loyal'; }).slice(0, 10);
		var deepest = list.filter(function (a) { return a.plays >= 20; })
			.sort(function (a, b) { return b.trackCount - a.trackCount; }).slice(0, 10);
		var oneTrack = list.filter(function (a) { return a.plays >= 10 && a.trackCount === 1; })
			.sort(function (a, b) { return b.plays - a.plays; }).slice(0, 10);

		var takeaway = list.length
			? 'Top companion: ' + list[0].name + ' (' + Math.round(list[0].minutes) + ' min across ' +
				list[0].span + ' days) · ' + flings.length + ' intense flings · ' +
				loyal.length + ' year-long loyalties'
			: 'Not enough artist data.';

		return {
			takeaway: takeaway,
			artists: list,
			top20: list.slice(0, 20),
			flings: flings,
			loyal: loyal,
			deepest: deepest,
			oneTrack: oneTrack
		};
	}

	function computeAttention(records, tzMode) {
		var music = records.filter(function (r) { return r.content_type === 'music'; });
		var maxDur = {};
		var playCounts = {};
		var i, r, uri;

		for (i = 0; i < music.length; i++) {
			r = music[i];
			uri = r.uri;
			if (!uri) continue;
			maxDur[uri] = Math.max(maxDur[uri] || 0, r.ms_played || 0);
			playCounts[uri] = (playCounts[uri] || 0) + 1;
		}

		var completions = [];
		var buckets = [0, 0, 0, 0, 0];
		for (i = 0; i < music.length; i++) {
			r = music[i];
			uri = r.uri;
			if (!uri || !maxDur[uri] || maxDur[uri] < 60000 || playCounts[uri] < 2) continue;
			var ratio = Math.min(1, (r.ms_played || 0) / maxDur[uri]);
			completions.push(ratio);
			buckets[Math.min(4, Math.floor(ratio * 5))]++;
		}
		completions.sort(function (a, b) { return a - b; });

		var byPlatform = {};
		var byHour = {};
		var byArtist = {};
		var reasonStart = {};
		var fwdbtn = 0;
		var totalMusic = music.length;

		for (i = 0; i < music.length; i++) {
			r = music[i];
			var plat = r.platform || 'unknown';
			if (!byPlatform[plat]) byPlatform[plat] = { plays: 0, skips: 0 };
			byPlatform[plat].plays++;
			if (r.skipped || r.looks_like_skip) byPlatform[plat].skips++;

			var hr = getHour(r.date, tzMode);
			if (!byHour[hr]) byHour[hr] = { plays: 0, skips: 0 };
			byHour[hr].plays++;
			if (r.skipped || r.looks_like_skip) byHour[hr].skips++;

			var artistName = r.creator || '(unknown)';
			if (!byArtist[artistName]) byArtist[artistName] = { plays: 0, skips: 0, name: artistName };
			byArtist[artistName].plays++;
			if (r.skipped || r.looks_like_skip) byArtist[artistName].skips++;

			var rs = r.reason_start || 'unknown';
			reasonStart[rs] = (reasonStart[rs] || 0) + 1;
			if (rs === 'fwdbtn') fwdbtn++;
		}

		var skipPlatforms = Object.keys(byPlatform).map(function (k) {
			return {
				name: k,
				plays: byPlatform[k].plays,
				skipRate: byPlatform[k].plays ? byPlatform[k].skips / byPlatform[k].plays : 0
			};
		}).sort(function (a, b) { return b.skipRate - a.skipRate; });

		var skipPlatformsReliable = skipPlatforms.filter(function (p) { return p.plays >= 50; });
		var topSkipPlat = skipPlatformsReliable[0] || skipPlatforms[0];

		var skipHours = [];
		for (i = 0; i < 24; i++) {
			var h = byHour[i] || { plays: 0, skips: 0 };
			skipHours.push({
				hour: i,
				label: pad2(i) + ':00',
				plays: h.plays,
				skipRate: h.plays ? h.skips / h.plays : 0
			});
		}

		var mostSkipped = Object.values(byArtist)
			.filter(function (a) { return a.plays >= 20; })
			.map(function (a) {
				return {
					name: a.name,
					plays: a.plays,
					skips: a.skips,
					skipRate: a.skips / a.plays
				};
			})
			.sort(function (a, b) { return b.skipRate - a.skipRate; })
			.slice(0, 10);

		var intentional = (reasonStart.clickrow || 0) + (reasonStart.playbtn || 0);
		var passive = (reasonStart.trackdone || 0);
		var restlessness = totalMusic ? (fwdbtn / totalMusic) * 100 : 0;
		var meanCompletion = completions.length
			? completions.reduce(function (s, v) { return s + v; }, 0) / completions.length
			: 0;

		var takeaway = completions.length
			? 'Mean completion ' + Math.round(meanCompletion * 100) + '% · restlessness ' +
				round1(restlessness) + '% fwdbtn · top skip platform: ' +
				(topSkipPlat ? topSkipPlat.name + ' (' + Math.round(topSkipPlat.skipRate * 100) + '%)' : 'n/a')
			: 'Not enough plays for attention analysis.';

		return {
			takeaway: takeaway,
			completions: completions,
			completionBuckets: buckets,
			meanCompletion: meanCompletion,
			skipPlatforms: skipPlatforms,
			skipHours: skipHours,
			mostSkipped: mostSkipped,
			reasonStart: reasonStart,
			intentional: intentional,
			passive: passive,
			restlessness: restlessness,
			measurablePlays: completions.length
		};
	}

	function computeObsessions(records, tzMode) {
		var music = records.filter(function (r) {
			return r.content_type === 'music' && r.date;
		}).sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

		var maxRun = 0;
		var maxRunTrack = '';
		var maxRunArtist = '';
		var run = 1;
		var i, r;

		for (i = 1; i < music.length; i++) {
			if (music[i].uri && music[i].uri === music[i - 1].uri) {
				run++;
				if (run > maxRun) {
					maxRun = run;
					maxRunTrack = music[i].title;
					maxRunArtist = music[i].creator;
				}
			} else {
				run = 1;
			}
		}

		// Peak plays in a single day per track
		var dayTrack = {};
		var trackMeta = {};
		for (i = 0; i < music.length; i++) {
			r = music[i];
			var uri = r.uri || (r.title + '|' + r.creator);
			var dk = getDayKey(r.date, tzMode);
			var key = dk + '|||' + uri;
			dayTrack[key] = (dayTrack[key] || 0) + 1;
			trackMeta[uri] = { title: r.title, artist: r.creator };
		}
		var peakDay = Object.keys(dayTrack).map(function (k) {
			var parts = k.split('|||');
			var meta = trackMeta[parts[1]] || { title: parts[1], artist: '' };
			return {
				day: parts[0],
				title: meta.title,
				artist: meta.artist,
				plays: dayTrack[k]
			};
		}).sort(function (a, b) { return b.plays - a.plays; }).slice(0, 10);

		// Song of the month
		var monthTrack = {};
		for (i = 0; i < music.length; i++) {
			r = music[i];
			var mk = getMonthKey(r.date, tzMode);
			var tk = (r.title || '') + ' — ' + (r.creator || '');
			if (!monthTrack[mk]) monthTrack[mk] = {};
			monthTrack[mk][tk] = (monthTrack[mk][tk] || 0) + 1;
		}
		var songOfMonth = Object.keys(monthTrack).sort().map(function (m) {
			var entries = Object.entries(monthTrack[m]).sort(function (a, b) { return b[1] - a[1]; });
			var top = entries[0] || ['—', 0];
			return { month: m, track: top[0], plays: top[1] };
		});

		// Comebacks: dormant > 120d then replayed >= 5 times after
		var byUri = {};
		for (i = 0; i < music.length; i++) {
			r = music[i];
			uri = r.uri;
			if (!uri) continue;
			if (!byUri[uri]) byUri[uri] = [];
			byUri[uri].push({ t: r.date, title: r.title, artist: r.creator });
		}
		var comebacks = [];
		Object.keys(byUri).forEach(function (u) {
			var list = byUri[u];
			if (list.length < 5) return;
			for (var j = 1; j < list.length; j++) {
				var gap = daysBetween(list[j - 1].t, list[j].t);
				if (gap > 120) {
					var after = list.length - j;
					if (after >= 5) {
						comebacks.push({
							title: list[j].title,
							artist: list[j].artist,
							gap: gap,
							after: after
						});
					}
					break;
				}
			}
		});
		comebacks.sort(function (a, b) { return b.after - a.after; });

		var takeaway = maxRun > 1
			? 'Longest on-repeat: ' + maxRun + '× “' + maxRunTrack + '” · ' +
				comebacks.length + ' comeback tracks after 120+ day gaps'
			: 'No strong repeat streaks found yet.';

		return {
			takeaway: takeaway,
			maxRun: maxRun,
			maxRunTrack: maxRunTrack,
			maxRunArtist: maxRunArtist,
			peakDay: peakDay,
			songOfMonth: songOfMonth,
			comebacks: comebacks.slice(0, 15)
		};
	}

	function computeContext(records, tzMode) {
		var monthlyCountry = {};
		var monthlyPlatform = {};
		var offline = 0;
		var incognito = 0;
		var offlineByMonth = {};
		var i, r, mk;

		for (i = 0; i < records.length; i++) {
			r = records[i];
			if (!r.date) continue;
			mk = getMonthKey(r.date, tzMode);
			if (!monthlyCountry[mk]) monthlyCountry[mk] = {};
			if (!monthlyPlatform[mk]) monthlyPlatform[mk] = {};
			var c = r.conn_country || '??';
			var p = r.platform || 'unknown';
			monthlyCountry[mk][c] = (monthlyCountry[mk][c] || 0) + 1;
			monthlyPlatform[mk][p] = (monthlyPlatform[mk][p] || 0) + 1;
			if (r.offline) {
				offline++;
				offlineByMonth[mk] = (offlineByMonth[mk] || 0) + 1;
			}
			if (r.incognito_mode) incognito++;
		}

		var months = Object.keys(monthlyCountry).sort();
		var countries = {};
		months.forEach(function (m) {
			Object.keys(monthlyCountry[m]).forEach(function (c) {
				countries[c] = true;
			});
		});
		var countryList = Object.keys(countries).sort();
		var countrySeries = countryList.map(function (c) {
			return {
				name: c,
				data: months.map(function (m) { return monthlyCountry[m][c] || 0; })
			};
		});

		var platforms = {};
		months.forEach(function (m) {
			Object.keys(monthlyPlatform[m]).forEach(function (p) {
				platforms[p] = true;
			});
		});
		var platformList = Object.keys(platforms).sort();
		var platformSeries = platformList.map(function (p) {
			return {
				name: p,
				data: months.map(function (m) { return monthlyPlatform[m][p] || 0; })
			};
		});

		var dominantCountries = months.map(function (m) {
			var entries = Object.entries(monthlyCountry[m]).sort(function (a, b) { return b[1] - a[1]; });
			return { month: m, country: entries[0] ? entries[0][0] : '??', plays: entries[0] ? entries[0][1] : 0 };
		});
		var traveled = dominantCountries.filter(function (d, idx, arr) {
			return idx > 0 && d.country !== arr[idx - 1].country;
		});

		var takeaway = records.length
			? 'Offline ' + offline.toLocaleString() + ' · Incognito ' + incognito.toLocaleString() +
				(traveled.length ? ' · country shifts: ' + traveled.map(function (t) {
					return t.month + '→' + t.country;
				}).join(', ') : ' · mostly one country')
			: 'No context data.';

		return {
			takeaway: takeaway,
			months: months,
			countrySeries: countrySeries,
			platformSeries: platformSeries,
			offline: offline,
			incognito: incognito,
			offlineByMonth: months.map(function (m) {
				return { month: m, plays: offlineByMonth[m] || 0 };
			}),
			dominantCountries: dominantCountries,
			total: records.length
		};
	}

	function compute(records, tzMode) {
		tzMode = tzMode || 'local';
		if (!records || !records.length) {
			return {
				tzMode: tzMode,
				fingerprint: { takeaway: 'Load data to see insights.' },
				taste: { takeaway: 'Load data to see insights.' },
				artists: { takeaway: 'Load data to see insights.' },
				attention: { takeaway: 'Load data to see insights.' },
				obsessions: { takeaway: 'Load data to see insights.' },
				context: { takeaway: 'Load data to see insights.' }
			};
		}
		return {
			tzMode: tzMode,
			fingerprint: computeFingerprint(records, tzMode),
			taste: computeTaste(records, tzMode),
			artists: computeArtists(records),
			attention: computeAttention(records, tzMode),
			obsessions: computeObsessions(records, tzMode),
			context: computeContext(records, tzMode)
		};
	}

	// ---------- chart helpers ----------

	function baseOpts() {
		return {
			chart: {
				toolbar: { show: false },
				background: 'transparent',
				foreColor: COLORS.muted,
				fontFamily: 'Inter, sans-serif'
			},
			theme: { mode: 'dark' },
			grid: { borderColor: COLORS.grid },
			tooltip: { theme: 'dark' }
		};
	}

	function setTakeaway(tabId, text) {
		var el = document.getElementById('takeaway-' + tabId);
		if (el) el.textContent = text || '';
	}

	function destroyTab(tabId) {
		var charts = tabCharts[tabId];
		if (!charts) return;
		Object.keys(charts).forEach(function (k) {
			try { charts[k].destroy(); } catch (e) { /* ignore */ }
		});
		tabCharts[tabId] = {};
	}

	function destroyAll() {
		Object.keys(tabCharts).forEach(destroyTab);
		tabCharts = {};
	}

	function storeChart(tabId, key, chart) {
		if (!tabCharts[tabId]) tabCharts[tabId] = {};
		tabCharts[tabId][key] = chart;
		chart.render();
	}

	function heatColor(v, max) {
		if (!max || v <= 0) return COLORS.heat[0];
		var t = v / max;
		var idx = Math.min(COLORS.heat.length - 1, Math.floor(t * (COLORS.heat.length - 1)));
		return COLORS.heat[idx];
	}

	function renderClockHeatmap(el, clock) {
		if (!el) return;
		var max = 0;
		var d, h;
		for (d = 0; d < 7; d++) {
			for (h = 0; h < 24; h++) if (clock[d][h] > max) max = clock[d][h];
		}
		var html = '<div class="heat-clock">';
		html += '<div class="heat-clock-corner"></div>';
		for (h = 0; h < 24; h++) {
			html += '<div class="heat-clock-hlabel">' + (h % 3 === 0 ? pad2(h) : '') + '</div>';
		}
		// Mon-first display order: Mon=1 ... Sun=0 last
		var order = [1, 2, 3, 4, 5, 6, 0];
		order.forEach(function (wd) {
			html += '<div class="heat-clock-dlabel">' + DAY_NAMES[wd] + '</div>';
			for (h = 0; h < 24; h++) {
				var v = clock[wd][h];
				html += '<div class="heat-cell" style="background:' + heatColor(v, max) +
					'" title="' + DAY_NAMES[wd] + ' ' + pad2(h) + ':00 — ' + formatMinutes(v) + ' min"></div>';
			}
		});
		html += '</div>';
		el.innerHTML = html;
	}

	function renderCalendarHeatmap(el, daily, dayKeys) {
		if (!el) return;
		if (!dayKeys.length) {
			el.innerHTML = '<p class="insight-empty">No daily data</p>';
			return;
		}
		var max = 0;
		dayKeys.forEach(function (k) { if (daily[k] > max) max = daily[k]; });
		var start = dayKeyToDate(dayKeys[0]);
		var end = dayKeyToDate(dayKeys[dayKeys.length - 1]);
		// align to Sunday
		var cur = new Date(start);
		cur.setUTCDate(cur.getUTCDate() - cur.getUTCDay());
		var html = '<div class="heat-calendar">';
		while (cur <= end || cur.getUTCDay() !== 0) {
			var key = cur.toISOString().slice(0, 10);
			var v = daily[key] || 0;
			var inRange = key >= dayKeys[0] && key <= dayKeys[dayKeys.length - 1];
			html += '<div class="heat-cal-cell' + (inRange ? '' : ' heat-cal-out') +
				'" style="background:' + (inRange ? heatColor(v, max) : 'transparent') +
				'" title="' + key + (inRange ? ' — ' + formatMinutes(v) + ' min' : '') + '"></div>';
			cur.setUTCDate(cur.getUTCDate() + 1);
			if (cur.getTime() > end.getTime() + 7 * 86400000) break;
		}
		html += '</div>';
		el.innerHTML = html;
	}

	// ---------- tab renderers ----------

	function renderFingerprint(data) {
		var tabId = 'fingerprint';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);
		var tzLabel = document.getElementById('fingerprintTzLabel');
		if (tzLabel) {
			tzLabel.textContent = 'Times shown in ' + (data.tzMode === 'utc' ? 'UTC' : 'local time');
		}

		renderClockHeatmap(document.getElementById('insightClockHeatmap'), data.clock || []);
		renderCalendarHeatmap(
			document.getElementById('insightCalendarHeatmap'),
			data.daily || {},
			data.dayKeys || []
		);

		var archEl = document.getElementById('insightSessionArchetypes');
		if (archEl && typeof ApexCharts !== 'undefined') {
			var a = data.archetypes || { quick: 0, commute: 0, deep: 0 };
			var chart = new ApexCharts(archEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'donut', height: 300 }),
				series: [a.quick, a.commute, a.deep],
				labels: ['Quick hit (<10m)', 'Commute (10–40m)', 'Deep dive (40m+)'],
				colors: [COLORS.amber, COLORS.blue, COLORS.primary],
				legend: { position: 'bottom' },
				dataLabels: { enabled: true }
			}));
			storeChart(tabId, 'archetypes', chart);
		}

		var modeEl = document.getElementById('insightMusicPodcastHour');
		if (modeEl && typeof ApexCharts !== 'undefined') {
			var hours = [];
			for (var i = 0; i < 24; i++) hours.push(pad2(i) + ':00');
			var chart2 = new ApexCharts(modeEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'area', height: 300, stacked: false }),
				series: [
					{ name: 'Music (min)', data: (data.musicByHour || []).map(round1) },
					{ name: 'Podcast (min)', data: (data.podcastByHour || []).map(round1) }
				],
				xaxis: { categories: hours, labels: { rotate: -45 } },
				yaxis: { title: { text: 'Minutes' } },
				colors: [COLORS.primary, COLORS.blue],
				stroke: { curve: 'smooth', width: 2 },
				fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
				dataLabels: { enabled: false },
				legend: { position: 'top' }
			}));
			storeChart(tabId, 'modes', chart2);
		}

		var set = function (id, t) {
			var el = document.getElementById(id);
			if (el) el.textContent = t;
		};
		set('insightActiveDays', (data.activeDays || 0).toLocaleString());
		set('insightLongestStreak', String(data.longestStreak || 0));
		set('insightMedianSession', round1(data.medianSession || 0) + ' min');
		set('insightSessionCount', (data.sessions ? data.sessions.length : 0).toLocaleString());
	}

	function renderTaste(data) {
		var tabId = 'taste';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);

		var set = function (id, t) {
			var el = document.getElementById(id);
			if (el) el.textContent = t;
		};
		set('insightGini', (data.gini || 0).toFixed(2));
		set('insightExploreScore', Math.round((data.entropy && data.entropy.normalized ? data.entropy.normalized : 0) * 100) + '/100');
		set('insightHalfArtists', data.half
			? data.half.count + ' (' + round1(data.half.pct) + '%)'
			: '—');

		var lorenzEl = document.getElementById('insightLorenz');
		if (lorenzEl && typeof ApexCharts !== 'undefined' && data.lorenz) {
			var chart = new ApexCharts(lorenzEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'line', height: 320 }),
				series: [
					{
						name: 'Your listening',
						data: data.lorenz.map(function (p) { return { x: p.x, y: p.y }; })
					},
					{
						name: 'Perfect equality',
						data: [{ x: 0, y: 0 }, { x: 100, y: 100 }]
					}
				],
				xaxis: {
					type: 'numeric',
					min: 0,
					max: 100,
					title: { text: '% of artists (least → most listened)' },
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				yaxis: {
					min: 0,
					max: 100,
					title: { text: '% of listening time' },
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				stroke: { width: [3, 2], dashArray: [0, 6], curve: 'smooth' },
				colors: [COLORS.primary, COLORS.muted],
				dataLabels: { enabled: false },
				legend: { position: 'top' },
				markers: { size: 0 }
			}));
			storeChart(tabId, 'lorenz', chart);
		}

		var discEl = document.getElementById('insightDiscovery');
		if (discEl && typeof ApexCharts !== 'undefined' && data.monthly) {
			var months = data.monthly.map(function (m) { return m.month; });
			var chart2 = new ApexCharts(discEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: 300 }),
				series: [
					{ name: 'New artists', data: data.monthly.map(function (m) { return m.newArtists; }) },
					{ name: 'New tracks', data: data.monthly.map(function (m) { return m.newTracks; }) }
				],
				xaxis: { categories: months, labels: { rotate: -45 } },
				colors: [COLORS.blue, COLORS.magenta],
				dataLabels: { enabled: false },
				legend: { position: 'top' }
			}));
			storeChart(tabId, 'discovery', chart2);
		}

		var novEl = document.getElementById('insightNovelty');
		if (novEl && typeof ApexCharts !== 'undefined' && data.monthly) {
			var annotations = {};
			var warmupMonths = data.monthly.filter(function (m) { return m.inWarmup; }).map(function (m) { return m.month; });
			if (warmupMonths.length) {
				annotations.xaxis = [{
					x: warmupMonths[0],
					x2: warmupMonths[warmupMonths.length - 1],
					fillColor: 'rgba(255, 184, 0, 0.15)',
					label: {
						text: 'Warm-up (first ' + (data.warmupDays || 30) + ' days)',
						style: { color: '#fff', background: COLORS.amber }
					}
				}];
			}
			var chart3 = new ApexCharts(novEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'line', height: 300 }),
				series: [{
					name: 'Novelty %',
					data: data.monthly.map(function (m) { return round1(m.noveltyPct); })
				}],
				xaxis: { categories: data.monthly.map(function (m) { return m.month; }), labels: { rotate: -45 } },
				yaxis: {
					min: 0,
					max: 100,
					title: { text: '% minutes on recently discovered tracks' },
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				stroke: { curve: 'smooth', width: 3 },
				colors: [COLORS.amber],
				dataLabels: { enabled: false },
				annotations: annotations
			}));
			storeChart(tabId, 'novelty', chart3);
		}
	}

	function renderArtists(data) {
		var tabId = 'artists';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);

		var bubbleEl = document.getElementById('insightArtistBubble');
		if (bubbleEl && typeof ApexCharts !== 'undefined' && data.artists) {
			var sample = data.artists.filter(function (a) { return a.plays >= 5; }).slice(0, 80);
			var seriesByKind = {
				loyal: { points: [], meta: [] },
				fling: { points: [], meta: [] },
				regular: { points: [], meta: [] }
			};
			sample.forEach(function (a) {
				seriesByKind[a.kind].points.push([a.span, a.plays, Math.max(3, Math.sqrt(a.minutes))]);
				seriesByKind[a.kind].meta.push(a);
			});
			var chart = new ApexCharts(bubbleEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bubble', height: 360 }),
				series: [
					{ name: 'Loyal', data: seriesByKind.loyal.points },
					{ name: 'Fling', data: seriesByKind.fling.points },
					{ name: 'Regular', data: seriesByKind.regular.points }
				],
				xaxis: { title: { text: 'Relationship span (days)' }, tickAmount: 6, min: 0 },
				yaxis: { title: { text: 'Plays' }, tickAmount: 5, min: 0 },
				colors: [COLORS.primary, COLORS.magenta, COLORS.blue],
				dataLabels: { enabled: false },
				legend: { position: 'top' },
				tooltip: {
					custom: function (ctx) {
						var kinds = ['loyal', 'fling', 'regular'];
						var meta = seriesByKind[kinds[ctx.seriesIndex]].meta[ctx.dataPointIndex];
						if (!meta) return '';
						return '<div class="apex-tooltip-custom"><strong>' + escapeHtml(meta.name) +
							'</strong><div>' + meta.plays + ' plays</div><div>' + meta.span +
							' day span</div><div>' + formatMinutes(meta.minutes) + ' min</div></div>';
					}
				}
			}));
			storeChart(tabId, 'bubble', chart);
		}

		var timelineEl = document.getElementById('insightArtistTimeline');
		if (timelineEl && typeof ApexCharts !== 'undefined' && data.top20) {
			var rangeData = data.top20.filter(function (a) { return a.first && a.last; }).map(function (a) {
				return {
					x: a.name,
					y: [a.first.getTime(), a.last.getTime()]
				};
			});
			var chart2 = new ApexCharts(timelineEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'rangeBar', height: Math.max(320, rangeData.length * 28) }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '70%' } },
				series: [{ name: 'Listening span', data: rangeData }],
				xaxis: { type: 'datetime' },
				colors: [COLORS.purple],
				dataLabels: { enabled: false }
			}));
			storeChart(tabId, 'timeline', chart2);
		}

		var depthEl = document.getElementById('insightCatalogDepth');
		if (depthEl && typeof ApexCharts !== 'undefined' && data.deepest) {
			var deepest = data.deepest.slice(0, 10);
			var chart3 = new ApexCharts(depthEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: Math.max(280, deepest.length * 28) }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{ name: 'Unique tracks', data: deepest.map(function (a) { return a.trackCount; }) }],
				xaxis: { categories: deepest.map(function (a) { return a.name; }) },
				colors: [COLORS.blue],
				dataLabels: { enabled: true }
			}));
			storeChart(tabId, 'depth', chart3);
		}

		var oneEl = document.getElementById('insightOneTrack');
		if (oneEl) {
			var rows = (data.oneTrack || []).slice(0, 8);
			if (!rows.length) {
				oneEl.innerHTML = '<p class="insight-empty">No single-track obsessions (≥10 plays)</p>';
			} else {
				oneEl.innerHTML = '<ul class="insight-list">' + rows.map(function (a) {
					return '<li><strong>' + escapeHtml(a.name) + '</strong> — ' +
						a.plays + ' plays of one track</li>';
				}).join('') + '</ul>';
			}
		}
	}

	function renderAttention(data) {
		var tabId = 'attention';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);

		var set = function (id, t) {
			var el = document.getElementById(id);
			if (el) el.textContent = t;
		};
		set('insightMeanCompletion', Math.round((data.meanCompletion || 0) * 100) + '%');
		set('insightRestlessness', round1(data.restlessness || 0) + '%');
		set('insightMeasurablePlays', (data.measurablePlays || 0).toLocaleString());

		var histEl = document.getElementById('insightCompletion');
		if (histEl && typeof ApexCharts !== 'undefined') {
			var chart = new ApexCharts(histEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: 280 }),
				series: [{ name: 'Plays', data: data.completionBuckets || [0, 0, 0, 0, 0] }],
				xaxis: {
					categories: ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'],
					title: { text: 'Estimated completion' }
				},
				yaxis: { title: { text: 'Plays' } },
				colors: [COLORS.primary],
				dataLabels: { enabled: true }
			}));
			storeChart(tabId, 'completion', chart);
		}

		var platEl = document.getElementById('insightSkipPlatform');
		if (platEl && typeof ApexCharts !== 'undefined' && data.skipPlatforms) {
			var plats = data.skipPlatforms;
			var chart2 = new ApexCharts(platEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: 280 }),
				series: [{
					name: 'Skip rate',
					data: plats.map(function (p) { return round1(p.skipRate * 100); })
				}],
				xaxis: { categories: plats.map(function (p) { return p.name; }) },
				yaxis: {
					max: 100,
					title: { text: 'Skip %' },
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				colors: [COLORS.magenta],
				dataLabels: {
					enabled: true,
					formatter: function (v) { return v + '%'; }
				}
			}));
			storeChart(tabId, 'skipPlat', chart2);
		}

		var hourEl = document.getElementById('insightSkipHour');
		if (hourEl && typeof ApexCharts !== 'undefined' && data.skipHours) {
			var chart3 = new ApexCharts(hourEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'line', height: 280 }),
				series: [{
					name: 'Skip rate',
					data: data.skipHours.map(function (h) { return round1(h.skipRate * 100); })
				}],
				xaxis: {
					categories: data.skipHours.map(function (h) { return h.label; }),
					labels: { rotate: -45 }
				},
				yaxis: {
					max: 100,
					title: { text: 'Skip %' },
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				stroke: { curve: 'smooth', width: 3 },
				colors: [COLORS.amber],
				dataLabels: { enabled: false }
			}));
			storeChart(tabId, 'skipHour', chart3);
		}

		var skipArtEl = document.getElementById('insightMostSkipped');
		if (skipArtEl && typeof ApexCharts !== 'undefined' && data.mostSkipped) {
			var skipped = data.mostSkipped.slice(0, 10);
			var chart4 = new ApexCharts(skipArtEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: Math.max(280, skipped.length * 28) }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{
					name: 'Skip %',
					data: skipped.map(function (a) { return round1(a.skipRate * 100); })
				}],
				xaxis: {
					categories: skipped.map(function (a) { return a.name; }),
					max: 100,
					labels: { formatter: function (v) { return Math.round(v) + '%'; } }
				},
				colors: [COLORS.purple],
				dataLabels: {
					enabled: true,
					formatter: function (v) { return v + '%'; }
				}
			}));
			storeChart(tabId, 'mostSkipped', chart4);
		}

		var intentEl = document.getElementById('insightIntentional');
		if (intentEl && typeof ApexCharts !== 'undefined') {
			var rs = data.reasonStart || {};
			var labels = Object.keys(rs).sort(function (a, b) { return rs[b] - rs[a]; }).slice(0, 6);
			var chart5 = new ApexCharts(intentEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'donut', height: 300 }),
				series: labels.map(function (k) { return rs[k]; }),
				labels: labels,
				colors: [COLORS.primary, COLORS.blue, COLORS.magenta, COLORS.amber, COLORS.purple, COLORS.muted],
				legend: { position: 'bottom' },
				dataLabels: { enabled: true }
			}));
			storeChart(tabId, 'intentional', chart5);
		}
	}

	function renderObsessions(data) {
		var tabId = 'obsessions';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);

		var set = function (id, t) {
			var el = document.getElementById(id);
			if (el) el.textContent = t;
		};
		set('insightMaxRun', data.maxRun > 1
			? data.maxRun + '× “' + (data.maxRunTrack || '') + '”'
			: '—');
		set('insightMaxRunArtist', data.maxRunArtist || '—');

		var peakEl = document.getElementById('insightPeakDay');
		if (peakEl) {
			var peaks = data.peakDay || [];
			peakEl.innerHTML = peaks.length
				? '<ul class="insight-list">' + peaks.slice(0, 8).map(function (p) {
					return '<li><strong>' + escapeHtml(p.title) + '</strong> — ' +
						escapeHtml(p.artist) + ' · ' + p.plays + ' plays on ' + escapeHtml(p.day) + '</li>';
				}).join('') + '</ul>'
				: '<p class="insight-empty">No peak-day data</p>';
		}

		var somEl = document.getElementById('insightSongOfMonth');
		if (somEl && typeof ApexCharts !== 'undefined' && data.songOfMonth) {
			var som = data.songOfMonth;
			var chart = new ApexCharts(somEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: Math.max(280, som.length * 36) }),
				plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
				series: [{ name: 'Plays', data: som.map(function (s) { return s.plays; }) }],
				xaxis: { categories: som.map(function (s) {
					var short = s.track.length > 40 ? s.track.slice(0, 37) + '…' : s.track;
					return s.month + ': ' + short;
				}) },
				colors: [COLORS.magenta],
				dataLabels: { enabled: true },
				tooltip: {
					y: {
						formatter: function (v, opts) {
							var s = som[opts.dataPointIndex];
							return v + ' plays — ' + (s ? s.track : '');
						}
					}
				}
			}));
			storeChart(tabId, 'som', chart);
		}

		var comeEl = document.getElementById('insightComebacks');
		if (comeEl) {
			var cbs = data.comebacks || [];
			comeEl.innerHTML = cbs.length
				? '<ul class="insight-list">' + cbs.map(function (c) {
					return '<li><strong>' + escapeHtml(c.title) + '</strong> — ' +
						escapeHtml(c.artist) + ' · dormant ' + c.gap + 'd then ' + c.after + '×</li>';
				}).join('') + '</ul>'
				: '<p class="insight-empty">No comebacks (120+ day gaps) found</p>';
		}
	}

	function renderContext(data) {
		var tabId = 'context';
		destroyTab(tabId);
		setTakeaway(tabId, data.takeaway);

		var set = function (id, t) {
			var el = document.getElementById(id);
			if (el) el.textContent = t;
		};
		set('insightOffline', (data.offline || 0).toLocaleString());
		set('insightIncognito', (data.incognito || 0).toLocaleString());
		set('insightOfflinePct', data.total
			? round1((data.offline / data.total) * 100) + '%'
			: '—');

		var countryEl = document.getElementById('insightCountry');
		if (countryEl && typeof ApexCharts !== 'undefined' && data.countrySeries) {
			var chart = new ApexCharts(countryEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'area', stacked: true, height: 320 }),
				series: data.countrySeries,
				xaxis: { categories: data.months || [], labels: { rotate: -45 } },
				yaxis: { title: { text: 'Plays' } },
				colors: [COLORS.primary, COLORS.blue, COLORS.magenta, COLORS.amber, COLORS.purple],
				stroke: { width: 1, curve: 'smooth' },
				fill: { type: 'solid', opacity: 0.7 },
				dataLabels: { enabled: false },
				legend: { position: 'top' }
			}));
			storeChart(tabId, 'country', chart);
		}

		var platEl = document.getElementById('insightPlatformMigration');
		if (platEl && typeof ApexCharts !== 'undefined' && data.platformSeries) {
			var chart2 = new ApexCharts(platEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'area', stacked: true, height: 320 }),
				series: data.platformSeries,
				xaxis: { categories: data.months || [], labels: { rotate: -45 } },
				yaxis: { title: { text: 'Plays' } },
				colors: [COLORS.blue, COLORS.primary, COLORS.amber, COLORS.purple, COLORS.magenta],
				stroke: { width: 1, curve: 'smooth' },
				fill: { type: 'solid', opacity: 0.7 },
				dataLabels: { enabled: false },
				legend: { position: 'top' }
			}));
			storeChart(tabId, 'platform', chart2);
		}

		var offEl = document.getElementById('insightOfflineTrend');
		if (offEl && typeof ApexCharts !== 'undefined' && data.offlineByMonth) {
			var chart3 = new ApexCharts(offEl, Object.assign({}, baseOpts(), {
				chart: Object.assign({}, baseOpts().chart, { type: 'bar', height: 260 }),
				series: [{
					name: 'Offline plays',
					data: data.offlineByMonth.map(function (m) { return m.plays; })
				}],
				xaxis: {
					categories: data.offlineByMonth.map(function (m) { return m.month; }),
					labels: { rotate: -45 }
				},
				colors: [COLORS.amber],
				dataLabels: { enabled: false }
			}));
			storeChart(tabId, 'offline', chart3);
		}
	}

	function renderTab(tabId, insights) {
		if (!insights) return;
		activeTab = tabId;
		if (tabId === 'overview') return;
		if (tabId === 'fingerprint') renderFingerprint(insights.fingerprint || {});
		else if (tabId === 'taste') renderTaste(insights.taste || {});
		else if (tabId === 'artists') renderArtists(insights.artists || {});
		else if (tabId === 'attention') renderAttention(insights.attention || {});
		else if (tabId === 'obsessions') renderObsessions(insights.obsessions || {});
		else if (tabId === 'context') renderContext(insights.context || {});
	}

	function getActiveTab() {
		return activeTab;
	}

	function setActiveTab(tabId) {
		activeTab = tabId;
	}

	global.SpotifyInsights = {
		compute: compute,
		renderTab: renderTab,
		destroyTab: destroyTab,
		destroyAll: destroyAll,
		getActiveTab: getActiveTab,
		setActiveTab: setActiveTab,
		getHour: getHour,
		getWeekday: getWeekday,
		getDayKey: getDayKey,
		sessionize: sessionize
	};
})(typeof window !== 'undefined' ? window : this);
