/*
 * camera.js — in-app camera capture for task-completion proof.
 *
 * Deliberately uses ONLY a live getUserMedia stream — there is no <input
 * type="file"> and no gallery access, so a photo can't be picked from the
 * camera roll (that's the whole point: proof has to be taken here, now).
 *
 *   DORM.camera.capture({ title, hint })
 *     -> Promise< { dataUrl, blob, width, height } >   on "Use this photo"
 *     -> rejects Error('cancelled')                     if the user backs out
 *     -> rejects Error('no-camera' | 'denied' | ...)    if the camera won't open
 *
 * Everything is torn down (tracks stopped, overlay removed) on any exit, so
 * the camera light never stays on. Fully testable offline — the only external
 * dependency is the browser's own camera.
 */
(function (DORM) {
  'use strict';

  var MAX_EDGE = 1280;     // downscale the long edge before encoding
  var JPEG_Q = 0.85;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // Draw the current video frame to a canvas, downscaled, and return JPEG.
  function grab(video) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    var scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    var w = Math.round(vw * scale), h = Math.round(vh * scale);
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    var dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q);
    return { canvas: canvas, dataUrl: dataUrl, width: w, height: h };
  }

  function dataUrlToBlob(dataUrl) {
    try {
      var parts = dataUrl.split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch (e) { return null; }
  }

  function capture(opts) {
    opts = opts || {};
    var t = (DORM.i18n && DORM.i18n.t) ? DORM.i18n.t : function (k) { return k; };

    return new Promise(function (resolve, reject) {
      if (!supported()) { reject(new Error('no-camera')); return; }

      var stream = null, facing = 'environment', settled = false;

      var overlay = el('div', 'cam-overlay');
      var video = el('video', 'cam-video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.muted = true;

      var shot = el('img', 'cam-shot');   // shown in preview state
      shot.hidden = true;

      var title = el('div', 'cam-title', esc(opts.title || t('cam_title')));
      var hint = el('div', 'cam-hint', esc(opts.hint || t('cam_hint')));

      var shutter = el('button', 'cam-btn shutter', '<span></span>');
      shutter.setAttribute('aria-label', t('cam_take'));
      var flip = el('button', 'cam-btn flip', '🔄');
      flip.setAttribute('aria-label', t('cam_flip'));
      var close = el('button', 'cam-btn close', '✕');
      close.setAttribute('aria-label', t('cancel'));

      var retake = el('button', 'btn ghost cam-retake', t('cam_retake'));
      var usebtn = el('button', 'btn cam-use', t('cam_use'));
      retake.hidden = true; usebtn.hidden = true;

      var topbar = el('div', 'cam-top');
      topbar.appendChild(close); topbar.appendChild(title);
      var bottom = el('div', 'cam-bottom');
      bottom.appendChild(flip); bottom.appendChild(shutter); bottom.appendChild(el('span', 'cam-spacer'));
      var review = el('div', 'cam-review');
      review.appendChild(retake); review.appendChild(usebtn);

      overlay.appendChild(video);
      overlay.appendChild(shot);
      overlay.appendChild(topbar);
      overlay.appendChild(hint);
      overlay.appendChild(bottom);
      overlay.appendChild(review);
      document.body.appendChild(overlay);
      document.body.classList.add('cam-open');

      var pending = null;   // { dataUrl, blob, width, height }

      function stop() {
        if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
      }
      function teardown() {
        stop();
        document.body.classList.remove('cam-open');
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKey);
      }
      function fail(err) { if (settled) return; settled = true; teardown(); reject(err); }
      function cancel() { fail(new Error('cancelled')); }
      function done(res) { if (settled) return; settled = true; teardown(); resolve(res); }

      function onKey(e) { if (e.key === 'Escape') cancel(); }
      document.addEventListener('keydown', onKey);

      function start() {
        stop();
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } }, audio: false
        }).then(function (s) {
          if (settled) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
          stream = s;
          video.srcObject = s;
          var p = video.play(); if (p && p.catch) p.catch(function () {});
        }).catch(function (e) {
          var name = e && e.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') fail(new Error('denied'));
          else if (name === 'NotFoundError' || name === 'OverconstrainedError') fail(new Error('no-camera'));
          else fail(new Error('camera-error'));
        });
      }

      function enterPreview(res) {
        pending = res;
        shot.src = res.dataUrl;
        shot.hidden = false; video.hidden = true;
        bottom.hidden = true; hint.hidden = true;
        review.classList.add('show');
        retake.hidden = false; usebtn.hidden = false;
        stop(); // freeze: no need to keep the camera live while reviewing
      }
      function exitPreview() {
        pending = null;
        shot.hidden = true; video.hidden = false;
        bottom.hidden = false; hint.hidden = false;
        review.classList.remove('show');
        retake.hidden = true; usebtn.hidden = true;
        start();
      }

      shutter.addEventListener('click', function () {
        var g = grab(video);
        if (!g) return;
        enterPreview({ dataUrl: g.dataUrl, blob: dataUrlToBlob(g.dataUrl), width: g.width, height: g.height });
      });
      flip.addEventListener('click', function () {
        facing = facing === 'environment' ? 'user' : 'environment';
        start();
      });
      close.addEventListener('click', cancel);
      retake.addEventListener('click', exitPreview);
      usebtn.addEventListener('click', function () { if (pending) done(pending); });

      start();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  DORM.camera = { capture: capture, supported: supported, dataUrlToBlob: dataUrlToBlob };
})(window.DORM = window.DORM || {});
