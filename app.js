/*
 * Pic Shrink — 100% client-side image compressor.
 *
 * Nothing in this file uploads, fetches, or transmits your images.
 * It loads each picture into a <canvas>, re-encodes it at a smaller
 * quality/size using the browser's built-in encoder, and hands you
 * back a download. All of it happens locally. Read on. :)
 */

const $ = (sel) => document.querySelector(sel);

const els = {
  quality: $('#quality'),
  qualityOut: $('#qualityOut'),
  targetOn: $('#targetOn'),
  targetMB: $('#targetMB'),
  format: $('#format'),
  picker: $('#picker'),
  drop: $('#drop'),
  results: $('#results'),
  list: $('#list'),
  summary: $('#summary'),
  downloadAll: $('#downloadAll'),
  clearAll: $('#clearAll'),
  confirmModal: $('#confirmModal'),
  confirmCancel: $('#confirmCancel'),
  confirmClear: $('#confirmClear'),
  tpl: $('#card-tpl'),
};

// Every processed image we keep around so settings changes can re-run them.
const jobs = [];

/* ---------- helpers ---------- */

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function pct(orig, next) {
  if (!orig) return 0;
  return Math.max(0, Math.round((1 - next / orig) * 100));
}

// Pick an output mime type. "auto" => webp if the browser can encode it, else jpeg.
let _webpOk = null;
function canEncodeWebp() {
  if (_webpOk !== null) return _webpOk;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  _webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
  return _webpOk;
}

function chooseMime(setting, sourceType) {
  if (setting !== 'auto') return setting;
  if (sourceType === 'image/png' || sourceType === 'image/webp' || sourceType === 'image/jpeg') {
    return canEncodeWebp() ? 'image/webp' : 'image/jpeg';
  }
  return canEncodeWebp() ? 'image/webp' : 'image/jpeg';
}

function extFor(mime) {
  return { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[mime] || 'img';
}

function outName(originalName, mime) {
  const base = originalName.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-shrunk.${extFor(mime)}`;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

// Decode a file into something we can draw, honoring EXIF orientation when possible.
async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

function drawScaled(source, scale) {
  const w = Math.max(1, Math.round((source.width || source.naturalWidth) * scale));
  const h = Math.max(1, Math.round((source.height || source.naturalHeight) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/*
 * Core compression.
 *  - "exact" mode: encode once at the chosen quality.
 *  - "target" mode: try the chosen quality; if still too big, step quality
 *    down to a floor, then progressively shrink dimensions until we fit
 *    (or run out of room). Keeps the result as crisp as the budget allows.
 */
async function compress(source, opts) {
  const mime = opts.mime;
  const png = mime === 'image/png'; // png ignores the quality arg
  const q = opts.quality;

  if (!opts.targetOn || png) {
    const canvas = drawScaled(source, 1);
    const blob = await canvasToBlob(canvas, mime, q);
    return { blob, width: canvas.width, height: canvas.height, hitTarget: true };
  }

  const target = opts.targetBytes;
  const qualityFloor = Math.max(0.4, q - 0.3); // don't drop too far below the user's pick
  let best = null;

  // 1) Try lowering quality at full resolution.
  for (let quality = q; quality >= qualityFloor - 1e-6; quality -= 0.05) {
    const canvas = drawScaled(source, 1);
    const blob = await canvasToBlob(canvas, mime, Math.max(0.4, quality));
    best = { blob, width: canvas.width, height: canvas.height, hitTarget: blob.size <= target };
    if (blob.size <= target) return best;
  }

  // 2) Still too big — shrink dimensions, re-trying quality at each step.
  let scale = 0.85;
  for (let i = 0; i < 12; i++) {
    const canvas = drawScaled(source, scale);
    for (let quality = q; quality >= qualityFloor - 1e-6; quality -= 0.1) {
      const blob = await canvasToBlob(canvas, mime, Math.max(0.4, quality));
      if (!best || blob.size < best.blob.size) {
        best = { blob, width: canvas.width, height: canvas.height, hitTarget: blob.size <= target };
      }
      if (blob.size <= target) {
        return { blob, width: canvas.width, height: canvas.height, hitTarget: true };
      }
    }
    if (canvas.width <= 400 || canvas.height <= 400) break;
    scale *= 0.85;
  }

  return best; // smallest we could manage, even if above target
}

/* ---------- per-image UI ---------- */

function readSettings() {
  return {
    quality: Number(els.quality.value) / 100,
    targetOn: els.targetOn.checked,
    targetBytes: Math.max(0.1, Number(els.targetMB.value) || 1) * 1024 * 1024,
    formatSetting: els.format.value,
  };
}

async function runJob(job) {
  const s = readSettings();
  const mime = chooseMime(s.formatSetting, job.file.type);
  job.card.querySelector('.status').textContent = 'Compressing…';
  job.card.querySelector('.status').classList.remove('warn');
  job.card.querySelector('.download').disabled = true;

  try {
    const result = await compress(job.source, {
      mime,
      quality: s.quality,
      targetOn: s.targetOn,
      targetBytes: s.targetBytes,
    });

    job.result = result;
    job.mime = mime;

    const savedPct = pct(job.file.size, result.blob.size);
    job.card.querySelector('.orig').textContent = fmtBytes(job.file.size);
    job.card.querySelector('.new').textContent = fmtBytes(result.blob.size);
    job.card.querySelector('.saved').textContent = savedPct > 0 ? `−${savedPct}%` : 'no gain';
    job.card.querySelector('.dims').textContent =
      `${result.width}×${result.height}px · ${extFor(mime).toUpperCase()}`;

    const status = job.card.querySelector('.status');
    if (s.targetOn && !result.hitTarget) {
      status.textContent = `Smallest possible: ${fmtBytes(result.blob.size)} (couldn't reach target without heavy quality loss)`;
      status.classList.add('warn');
    } else {
      status.textContent = '✓ Ready';
    }

    const dl = job.card.querySelector('.download');
    dl.disabled = false;
  } catch (err) {
    const status = job.card.querySelector('.status');
    status.textContent = err.message || 'Failed to process';
    status.classList.add('warn');
  }
  updateSummary();
}

function download(job) {
  if (!job.result) return;
  const url = URL.createObjectURL(job.result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName(job.file.name, job.mime);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateSummary() {
  const done = jobs.filter((j) => j.result);
  if (!done.length) { els.summary.textContent = ''; return; }
  const origTotal = done.reduce((a, j) => a + j.file.size, 0);
  const newTotal = done.reduce((a, j) => a + j.result.blob.size, 0);
  els.summary.innerHTML =
    `${done.length} image${done.length > 1 ? 's' : ''} · ${fmtBytes(origTotal)} → ` +
    `<strong>${fmtBytes(newTotal)}</strong> (saved ${pct(origTotal, newTotal)}%)`;
  els.downloadAll.disabled = false;
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  els.results.hidden = false;

  for (const file of files) {
    const node = els.tpl.content.firstElementChild.cloneNode(true);
    const job = { file, card: node, source: null, result: null, mime: null };
    jobs.push(job);

    node.querySelector('.name').textContent = file.name;
    node.querySelector('.name').title = file.name;
    node.querySelector('.orig').textContent = fmtBytes(file.size);
    node.querySelector('.download').addEventListener('click', () => download(job));

    const thumbUrl = URL.createObjectURL(file);
    job.thumbUrl = thumbUrl;
    node.querySelector('.thumb img').src = thumbUrl;

    els.list.appendChild(node);

    try {
      job.source = await decode(file);
      await runJob(job);
    } catch (err) {
      const status = node.querySelector('.status');
      status.textContent = err.message || 'Could not read this image';
      status.classList.add('warn');
    }
  }
}

// Re-run everything when settings change (debounced).
let reRunTimer = null;
function rerunAll() {
  clearTimeout(reRunTimer);
  reRunTimer = setTimeout(() => {
    jobs.forEach((j) => { if (j.source) runJob(j); });
  }, 250);
}

/* ---------- clear / reset ---------- */

function openConfirm() {
  els.confirmModal.hidden = false;
  els.confirmModal.classList.add('show');
  els.confirmCancel.focus();
  document.addEventListener('keydown', onConfirmKey);
}

function closeConfirm() {
  els.confirmModal.classList.remove('show');
  els.confirmModal.hidden = true;
  document.removeEventListener('keydown', onConfirmKey);
  els.clearAll.focus();
}

function onConfirmKey(e) {
  if (e.key === 'Escape') closeConfirm();
}

// Wipe the batch: free image memory (object URLs + decoded bitmaps), reset the UI.
// Settings are intentionally left as-is so the next batch uses the same prefs.
function clearAll() {
  jobs.forEach((j) => {
    if (j.thumbUrl) URL.revokeObjectURL(j.thumbUrl);
    if (j.source && typeof j.source.close === 'function') j.source.close();
  });
  jobs.length = 0;
  els.list.innerHTML = '';
  els.summary.innerHTML = '';
  els.downloadAll.disabled = true;
  els.results.hidden = true;
}

/* ---------- wiring ---------- */

els.quality.addEventListener('input', () => {
  els.qualityOut.textContent = `${els.quality.value}%`;
  rerunAll();
});
els.targetOn.addEventListener('change', rerunAll);
els.targetMB.addEventListener('input', rerunAll);
els.format.addEventListener('change', rerunAll);

els.picker.addEventListener('change', (e) => addFiles(e.target.files));
els.drop.addEventListener('click', () => els.picker.click());
els.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.picker.click(); }
});

['dragenter', 'dragover'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('drag'); }));
els.drop.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.files;
  if (items?.length) addFiles(items);
});

els.downloadAll.addEventListener('click', () => {
  jobs.filter((j) => j.result).forEach((j, i) => setTimeout(() => download(j), i * 250));
});

els.clearAll.addEventListener('click', openConfirm);
els.confirmCancel.addEventListener('click', closeConfirm);
els.confirmClear.addEventListener('click', () => { clearAll(); closeConfirm(); });
els.confirmModal.addEventListener('click', (e) => {
  if (e.target === els.confirmModal) closeConfirm();
});
