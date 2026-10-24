// Smooth in-page navigation for the header nav, logo and hero cards.
// CSS `scroll-behavior: smooth` alone is skipped by browsers when the OS asks for reduced motion and can't scroll
// to the top for the logo (which links to the page itself), so links that point at the current page animate here.
(function () {
	'use strict';

	const HEADER_GAP = 16; // breathing room between the fixed header and the section heading
	let frame = null;

	function samePage(url) {
		const normalize = path => path.replace(/index\.html$/, '').replace(/\/$/, '');
		return url.origin === location.origin && normalize(url.pathname) === normalize(location.pathname);
	}

	function headerOffset() {
		const header = document.getElementById('mainHeader');
		return header ? header.getBoundingClientRect().height + HEADER_GAP : 0;
	}

	function cancel() {
		if (frame) cancelAnimationFrame(frame);
		frame = null;
		document.documentElement.style.scrollBehavior = '';
	}

	function animateTo(targetY) {
		cancel();
		const startY = window.scrollY;
		const maxY = document.documentElement.scrollHeight - window.innerHeight;
		const distance = Math.max(0, Math.min(targetY, maxY)) - startY;
		if (Math.abs(distance) < 2) return;
		const duration = Math.min(900, Math.max(350, Math.abs(distance) * 0.4));
		const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
		let startTime = null;
		document.documentElement.style.scrollBehavior = 'auto'; // our frames must land instantly, not be re-smoothed by CSS

		function step(now) {
			if (startTime === null) startTime = now;
			const progress = Math.min(1, (now - startTime) / duration);
			window.scrollTo(0, startY + distance * ease(progress));
			if (progress < 1) frame = requestAnimationFrame(step);
			else cancel();
		}
		frame = requestAnimationFrame(step);
	}

	// Let the user take over mid-animation
	['wheel', 'touchstart', 'keydown'].forEach(type => window.addEventListener(type, () => { if (frame) cancel(); }, { passive: true }));

	document.addEventListener('click', function (e) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const link = e.target.closest('a[href]');
		if (!link || link.target === '_blank') return;
		const url = new URL(link.href, location.href);
		if (!samePage(url)) return;

		const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
		if (url.hash && !target) return;
		e.preventDefault();

		animateTo(target ? target.getBoundingClientRect().top + window.scrollY - headerOffset() : 0);
		history.pushState(null, '', target ? url.hash : location.pathname + location.search);
		if (target) {
			// Move keyboard focus with the view, without a second jump
			if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
			target.focus({ preventScroll: true });
		}
	});
})();
