/* =========================================================
   HEART → VIDEO CONTROLLER
   The clip (assets/clip.mp4) does NOT play on page load. It starts
   only when script.js calls IntroVideo.play() from inside the
   heart's click handler, so the browser treats it as a user gesture
   and lets the clip play with its ORIGINAL audio (never muted).

   IntroVideo.play() returns a Promise that resolves when the video's
   real "ended" event fires. If the clip cannot load / decode, it
   resolves anyway ('error' / 'stalled'), so nobody is ever stuck.
   No fixed timer decides when the video is over.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var screen = document.getElementById('intro-screen');
  var video = document.getElementById('intro-video');
  var tapBtn = document.getElementById('intro-tap');
  var retryBtn = document.getElementById('intro-retry');
  var skipBtn = document.getElementById('intro-skip');

  // Nothing heavy is gated on the video any more (it plays later, after the heart).
  window.__introReady = Promise.resolve();

  var FADE_MS = 1000;        // must match the CSS transition on #intro-screen
  var HOLD_MS = 350;         // let the last frame breathe before fading
  var START_LIMIT_MS = 20000; // if the clip never starts, show the retry panel (never a blank screen)

  var runPromise = null;

  function play() {
    if (runPromise) return runPromise;          // the clip plays once per opening
    runPromise = new Promise(function (resolve) {
      if (!screen || !video) { resolve('unavailable'); return; }

      var finished = false, started = false, needsTap = false, failed = false, startTimer = null;

      // Original audio: make sure it is NOT muted.
      video.muted = false;
      video.defaultMuted = false;
      video.volume = 1;
      video.loop = false;
      video.playsInline = true;

      function showLoader(on) { screen.classList.toggle('intro-loading', !!on); }

      function tryPlay() {
        if (finished || failed || !video.paused) return;
        var p;
        try { p = video.play(); } catch (e) { fail('error'); return; }
        if (p && typeof p.catch === 'function') {
          p.catch(function (err) {
            if (finished || failed) return;
            if (err && err.name === 'NotAllowedError') {
              // Rare (e.g. strict mobile policies): ask for one more tap.
              // We never mute the video to get around this.
              needsTap = true;
              showLoader(false);
              screen.classList.add('intro-needs-tap');
            } else if (err && err.name !== 'AbortError') {
              fail('error');
            }
            // AbortError: a later canplay/playing event retries
          });
        }
      }

      function onPlaying() {
        started = true; needsTap = false;
        clearTimeout(startTimer);
        showLoader(false);
        screen.classList.remove('intro-needs-tap');
        screen.classList.add('intro-video-ready');
      }
      function onLoaded() { screen.classList.add('intro-video-ready'); }
      function onCanPlay() { if (!failed && !finished && video.paused && !needsTap && !video.ended) tryPlay(); }
      function onWaiting() { if (started && !finished) showLoader(true); }
      function onTime() { if (screen.classList.contains('intro-loading')) showLoader(false); }
      function onEnded() { finish('ended'); }
      function onError() {
        if (finished || failed) return;
        var err = video.error;
        if (err && err.code === 1) return;       // MEDIA_ERR_ABORTED: not fatal
        fail('error');
      }
      function onManualTap(e) {
        if (!needsTap || failed) return;
        if (e) e.preventDefault();
        needsTap = false;
        screen.classList.remove('intro-needs-tap');
        tryPlay();
      }
      function onVisible() {
        if (!document.hidden && !finished && !failed && started && video.paused && !video.ended) tryPlay();
      }

      video.addEventListener('playing', onPlaying);
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError, true);   // capture: <source> errors too
      Array.prototype.forEach.call(video.querySelectorAll('source'), function (s) { s.addEventListener('error', onError); });
      if (tapBtn) tapBtn.addEventListener('click', onManualTap);
      if (retryBtn) retryBtn.addEventListener('click', onRetry);
      if (skipBtn) skipBtn.addEventListener('click', onSkip);
      screen.addEventListener('pointerup', onManualTap);
      document.addEventListener('visibilitychange', onVisible);

      function detach() {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError, true);
        if (tapBtn) tapBtn.removeEventListener('click', onManualTap);
        if (retryBtn) retryBtn.removeEventListener('click', onRetry);
        if (skipBtn) skipBtn.removeEventListener('click', onSkip);
        screen.removeEventListener('pointerup', onManualTap);
        document.removeEventListener('visibilitychange', onVisible);
      }

      // The clip could not load/play: show a clear message with Retry. The site does NOT open
      // by itself (that would silently skip the video); the visitor decides.
      function fail(reason) {
        if (finished || failed) return;
        failed = true; started = false; needsTap = false;
        clearTimeout(startTimer);
        try { video.pause(); } catch (e) { /* ignore */ }
        showLoader(false);
        screen.classList.remove('intro-needs-tap');
        screen.classList.add('intro-failed');
        screen.classList.add('intro-error');
        if (window.console) console.warn('[intro] clip did not play:', reason, video.error || '');
        if (retryBtn) { try { retryBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
      function onRetry(e) {
        if (e) e.preventDefault();
        if (finished || !failed) return;
        failed = false; started = false;
        screen.classList.remove('intro-error', 'intro-failed');
        showLoader(true);
        try { video.load(); video.currentTime = 0; } catch (err) { /* ignore */ }   // re-request the file
        tryPlay();                                    // inside the retry tap, so audio is allowed
        startTimer = setTimeout(function () { if (!started && !finished) fail('stalled'); }, START_LIMIT_MS);
      }
      function onSkip(e) {
        if (e) e.preventDefault();
        finish('skipped');                            // the visitor chose to go on without the clip
      }

      function finish(reason) {
        if (finished) return;
        finished = true;
        clearTimeout(startTimer);
        detach();
        showLoader(false);
        screen.classList.remove('intro-needs-tap');
        var natural = reason === 'ended';
        if (!natural) screen.classList.add('intro-failed');   // hide any broken frame
        screen.classList.remove('intro-error');
        // Resolve NOW: script.js starts the website song and the opening
        // sequence at this moment (the video has really ended, so the two
        // audio sources can never overlap). The overlay then fades out.
        resolve(reason);
        setTimeout(fade, natural ? HOLD_MS : 0);
      }

      function fade() {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            screen.classList.add('intro-leaving');
            var removed = false;
            function cleanup() {
              if (removed) return;
              removed = true;
              screen.removeEventListener('transitionend', onEnd);
              try {
                video.pause();
                video.removeAttribute('src');
                while (video.firstChild) video.removeChild(video.firstChild);
                video.load();                     // release decoder + buffers
              } catch (e) { /* ignore */ }
              if (screen.parentNode) screen.parentNode.removeChild(screen);
              root.classList.remove('intro-playing');
            }
            function onEnd(e) { if (e.target === screen && e.propertyName === 'opacity') cleanup(); }
            screen.addEventListener('transitionend', onEnd);
            setTimeout(cleanup, FADE_MS + 250);   // fallback if transitionend never fires
          });
        });
      }

      /* ---- go: show the overlay and start playback inside the user's click ---- */
      root.classList.add('intro-playing');
      screen.classList.add('intro-show');
      if (video.readyState >= 2) screen.classList.add('intro-video-ready');
      try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
      tryPlay();                                   // synchronous, inside the click gesture
      // Fail open only if the clip never starts (missing file, dead network).
      // This does NOT decide when the video ends; the 'ended' event does.
      startTimer = setTimeout(function () { if (!started && !finished) fail('stalled'); }, START_LIMIT_MS);
      setTimeout(function () { if (!started && !finished && !failed && !needsTap) showLoader(true); }, 900);
      // already-known failure (e.g. file missing before the click)
      if (video.error || (video.networkState === 3 && video.readyState === 0)) fail('error');
    });
    return runPromise;
  }

  window.IntroVideo = { play: play };
})();
