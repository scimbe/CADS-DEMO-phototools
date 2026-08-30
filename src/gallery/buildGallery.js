"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * src/gallery/buildGallery.js
 *
 * Renders the organize manifest into a single, self-contained `gallery.html` that sits at the
 * root of the --out directory. It references the sorted photos by their manifest `destRelPath`
 * (relative links), so the page works both opened straight from disk and served by the wrapper
 * GUI out of the same output directory -- no copying, no base64 bloat of the full-res images.
 *
 * Everything (CSS + JS) is inlined; there is NO external CDN, font, or script dependency. The
 * interactive part is a plain click-to-enlarge lightbox: click a thumbnail to open it full-size,
 * Esc or a click on the backdrop closes it, and Left/Right arrows (or the on-screen buttons) step
 * through the batch. When the optional --vision step produced a caption/tags for a photo, they are
 * shown under the thumbnail and in the lightbox; without vision the page still renders cleanly
 * from EXIF date + city alone.
 */

/** escapeHtml(s) -> HTML-attribute/text-safe string. */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** prettyDate("2025:01:15 10:15:00") -> "2025-01-15 10:15", or "undated". */
function prettyDate(dto) {
  if (!dto || typeof dto !== "string") return "undated";
  const m = dto.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return dto;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** groupKeyLabel(entry) -> a human "YYYY-MM-DD . City" heading for the date+city bucket. */
function groupKeyLabel(entry) {
  const day = (entry.dateTimeOriginal || "").slice(0, 10).replace(/:/g, "-") || "undated";
  const city = entry.city || "unknown-location";
  return `${day} · ${city}`;
}

/**
 * toGalleryData(manifest) -> { title, generatedAt, count, photos: [...] }
 * A flat, render-ready projection of the manifest: one photo object per entry, in the manifest's
 * own order, carrying only what the page needs (relative src, city, date, optional vision).
 */
function toGalleryData(manifest) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const photos = entries.map((e) => {
    const vision = e.vision && typeof e.vision === "object" ? e.vision : null;
    return {
      src: e.destRelPath,
      name: e.destRelPath ? e.destRelPath.split("/").pop() : "",
      group: groupKeyLabel(e),
      city: e.city || "unknown-location",
      date: prettyDate(e.dateTimeOriginal),
      caption: vision && typeof vision.caption === "string" ? vision.caption : null,
      tags: vision && Array.isArray(vision.tags) ? vision.tags : [],
    };
  });
  return {
    title: "phototools — organized photo batch",
    generatedAt: new Date().toISOString(),
    count: photos.length,
    photos,
  };
}

const STYLE = `
:root{--bg:#0f1115;--panel:#161a22;--ink:#e8eaed;--muted:#9aa4b2;--line:#232a36;--accent:#5b9dff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
header{padding:24px 20px 8px;max-width:1100px;margin:0 auto}
header h1{margin:0 0 4px;font-size:20px}
header p{margin:0;color:var(--muted);font-size:13px}
main{max-width:1100px;margin:0 auto;padding:12px 20px 40px}
.group h2{font-size:14px;color:var(--muted);font-weight:600;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:left;padding:0;color:inherit;font:inherit;cursor:zoom-in;display:flex;flex-direction:column}
.card:hover,.card:focus-visible{border-color:var(--accent);outline:none}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#0b0d11}
.card .meta{padding:8px 10px}
.card .cap{font-size:13px;margin:0 0 6px}
.card .sub{font-size:11px;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.tag{font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 7px}
.lb{position:fixed;inset:0;background:rgba(6,8,12,.92);display:none;align-items:center;justify-content:center;flex-direction:column;padding:24px;z-index:50}
.lb.open{display:flex}
.lb img{max-width:92vw;max-height:72vh;object-fit:contain;border-radius:6px;background:#0b0d11}
.lb .lbmeta{max-width:min(92vw,900px);margin-top:14px;text-align:center}
.lb .lbcap{font-size:15px;margin:0 0 6px}
.lb .lbsub{font-size:12px;color:var(--muted)}
.lb .tags{justify-content:center}
.lb button{position:absolute;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;cursor:pointer;font-size:20px;line-height:1;width:44px;height:44px}
.lb .close{top:16px;right:16px}
.lb .prev{left:16px;top:50%;transform:translateY(-50%)}
.lb .next{right:16px;top:50%;transform:translateY(-50%)}
.lb button:hover,.lb button:focus-visible{background:rgba(91,157,255,.35);outline:none}
.lb .counter{position:absolute;top:20px;left:16px;color:var(--muted);font-size:12px}
footer{max-width:1100px;margin:0 auto;padding:24px 20px 40px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
footer a{color:var(--muted);text-decoration:none;border-bottom:1px solid var(--line)}
footer a:hover{color:var(--ink)}
footer .row{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px}
@media (prefers-reduced-motion:no-preference){.lb.open{animation:fade .12s ease}}
@keyframes fade{from{opacity:0}to{opacity:1}}
`;

// Client-side lightbox controller. Self-contained, no dependencies. Reads PHOTO data injected as
// a JSON <script>. Keyboard: Esc closes, Left/Right navigate. Backdrop click closes; clicks on the
// image or controls don't. Focus moves into the dialog on open and is restored on close.
const SCRIPT = `
(function(){
  var data=(window.__GALLERY__&&window.__GALLERY__.photos)||[];
  var lb=document.getElementById('lb');
  if(!lb)return;
  var img=document.getElementById('lb-img');
  var cap=document.getElementById('lb-cap');
  var sub=document.getElementById('lb-sub');
  var tags=document.getElementById('lb-tags');
  var counter=document.getElementById('lb-counter');
  var cur=-1, lastFocus=null;
  function esc(s){return String(s==null?'':s);}
  function render(i){
    var p=data[i]; if(!p)return;
    cur=i;
    img.src=p.src; img.alt=p.caption||p.name||'photo';
    cap.textContent=p.caption||p.name||'';
    sub.textContent=(p.date||'')+(p.city?(' \\u00b7 '+p.city):'');
    tags.innerHTML='';
    (p.tags||[]).forEach(function(t){var s=document.createElement('span');s.className='tag';s.textContent=t;tags.appendChild(s);});
    counter.textContent=(i+1)+' / '+data.length;
  }
  function open(i){lastFocus=document.activeElement;render(i);lb.classList.add('open');lb.setAttribute('aria-hidden','false');document.getElementById('lb-close').focus();}
  function close(){lb.classList.remove('open');lb.setAttribute('aria-hidden','true');if(lastFocus&&lastFocus.focus)lastFocus.focus();}
  function step(d){if(cur<0)return;var n=(cur+d+data.length)%data.length;render(n);}
  document.querySelectorAll('[data-idx]').forEach(function(el){
    var i=parseInt(el.getAttribute('data-idx'),10);
    el.addEventListener('click',function(){open(i);});
  });
  document.getElementById('lb-close').addEventListener('click',close);
  document.getElementById('lb-prev').addEventListener('click',function(e){e.stopPropagation();step(-1);});
  document.getElementById('lb-next').addEventListener('click',function(e){e.stopPropagation();step(1);});
  lb.addEventListener('click',function(e){if(e.target===lb)close();});
  img.addEventListener('click',function(e){e.stopPropagation();});
  document.addEventListener('keydown',function(e){
    if(!lb.classList.contains('open'))return;
    if(e.key==='Escape')close();
    else if(e.key==='ArrowLeft')step(-1);
    else if(e.key==='ArrowRight')step(1);
  });
})();
`;

const FOOTER_HTML = `
<footer>
  <div>phototools · a <a href="https://bunsenbrenner.org" target="_blank" rel="noopener">bunsenbrenner.org</a> marketplace demo</div>
  <div class="row">
    <a href="https://steady.page/plans/77a32d9c-c399-4ca1-9515-7a628c7a9413" target="_blank" rel="noopener">Als Mitglied unterstützen</a>
    <a href="https://buymeacoffee.com/bunsenbrenner" target="_blank" rel="noopener">Buy me a coffee</a>
    <a href="https://github.com/scimbe/CADS-Tunnel" target="_blank" rel="noopener">GitHub</a>
    <a href="https://bunsenbrenner.org/legal-notice" target="_blank" rel="noopener">Legal notice</a>
    <a href="https://bunsenbrenner.org/privacy-policy" target="_blank" rel="noopener">Privacy policy</a>
    <a href="https://bunsenbrenner.org/terms-of-use" target="_blank" rel="noopener">Terms of use</a>
  </div>
</footer>`;

/** cardHtml(photo, idx) -> one thumbnail button, opening lightbox index idx on click. */
function cardHtml(photo, idx) {
  const alt = escapeHtml(photo.caption || photo.name || "photo");
  const capLine = photo.caption
    ? `<p class="cap">${escapeHtml(photo.caption)}</p>`
    : `<p class="cap">${escapeHtml(photo.name)}</p>`;
  const tags = (photo.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("");
  return `
      <button class="card" type="button" data-idx="${idx}" aria-label="Enlarge: ${alt}">
        <img src="${escapeHtml(photo.src)}" alt="${alt}" loading="lazy">
        <div class="meta">
          ${capLine}
          <div class="sub">${escapeHtml(photo.date)} · ${escapeHtml(photo.city)}</div>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
        </div>
      </button>`;
}

/**
 * buildGalleryHtml(manifest) -> string
 * Pure: turns a manifest into the full self-contained HTML document. No filesystem, no network --
 * unit-testable, and the same function organize uses to write gallery.html.
 */
function buildGalleryHtml(manifest) {
  const data = toGalleryData(manifest);

  // Preserve manifest order but visually cluster by (date, city), tracking each photo's flat index
  // so the lightbox array and the DOM data-idx stay aligned.
  const groups = new Map();
  data.photos.forEach((p, idx) => {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push({ p, idx });
  });

  const groupsHtml = [...groups.entries()]
    .map(([label, items]) => {
      const cards = items.map(({ p, idx }) => cardHtml(p, idx)).join("");
      return `
    <section class="group">
      <h2>${escapeHtml(label)}</h2>
      <div class="grid">${cards}
      </div>
    </section>`;
    })
    .join("");

  const withVision = data.photos.filter((p) => p.caption).length;
  const visionNote =
    withVision > 0
      ? `${withVision} of ${data.count} with an AI content description`
      : `EXIF date + location only (run with --vision for AI content descriptions)`;

  // Inject only the fields the client needs; escape < to keep the JSON out of </script> trouble.
  const clientData = JSON.stringify({
    photos: data.photos.map((p) => ({
      src: p.src,
      name: p.name,
      caption: p.caption,
      tags: p.tags,
      date: p.date,
      city: p.city,
    })),
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>Organized photo batch</h1>
  <p>${data.count} photo(s) · ${escapeHtml(visionNote)} · click any photo to enlarge</p>
</header>
<main>${groupsHtml}
</main>

<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="Photo viewer" aria-hidden="true">
  <span class="counter" id="lb-counter"></span>
  <button class="close" id="lb-close" type="button" aria-label="Close (Esc)">×</button>
  <button class="prev" id="lb-prev" type="button" aria-label="Previous (Left arrow)">‹</button>
  <button class="next" id="lb-next" type="button" aria-label="Next (Right arrow)">›</button>
  <img id="lb-img" src="" alt="">
  <div class="lbmeta">
    <p class="lbcap" id="lb-cap"></p>
    <div class="lbsub" id="lb-sub"></div>
    <div class="tags" id="lb-tags"></div>
  </div>
</div>
${FOOTER_HTML}
<script>window.__GALLERY__=${clientData};</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * buildGallery(manifest, outPath) -> Promise<void>
 * Writes buildGalleryHtml(manifest) to outPath (utf8). outPath should be `<out>/gallery.html` so
 * the relative destRelPath image links resolve.
 */
async function buildGallery(manifest, outPath) {
  const html = buildGalleryHtml(manifest);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, "utf8");
}

module.exports = {
  buildGallery,
  buildGalleryHtml,
  toGalleryData,
  escapeHtml,
  prettyDate,
  groupKeyLabel,
};
