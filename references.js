const section = document.querySelector('[data-references-section]');
const grid = document.querySelector('[data-references-grid]');
const all = document.body.classList.contains('references-page');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card(video, index) {
  const title = video.title || `Erfahrungen mit Finde dein Ding · ${index + 1}`;
  const article = document.createElement('article');
  article.className = 'reference-card';
  article.innerHTML = `<div class="reference-media"><button class="reference-play" type="button" aria-label="${escape(title)} auf YouTube abspielen"><img loading="lazy" width="480" height="270" src="/api/leads?action=references-thumbnail&amp;id=${video.id}" alt="Vorschaubild: ${escape(title)}"><span class="reference-play-icon" aria-hidden="true">▶</span><span class="reference-play-label">Video starten · YouTube</span></button></div><div class="reference-copy"><small>REFERENZ ${String(index + 1).padStart(2, '0')}</small><h3>${escape(title)}</h3><a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer">Auf YouTube ansehen ↗</a></div>`;
  article.querySelector('img').addEventListener('error', event => { event.target.hidden = true; });
  article.querySelector('button').addEventListener('click', () => {
    // Load YouTube only after the visitor explicitly chooses to play this video.
    grid.querySelectorAll('iframe').forEach(frame => { frame.src = frame.src.replace('autoplay=1', 'autoplay=0'); });
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`;
    iframe.title = title;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    article.querySelector('.reference-media').replaceChildren(iframe);
    iframe.focus();
  });
  return article;
}

if (section && grid) {
  try {
    const response = await fetch(`/api/leads?action=references-public${all ? '' : '&limit=6'}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Referenzen konnten gerade nicht geladen werden. Bitte versuche es später erneut.');
    const data = await response.json();
    const visible = data.enabled && data.videos.length > 0;
    document.querySelectorAll('[data-references-nav]').forEach(link => { link.hidden = !visible; });
    if (visible) {
      grid.replaceChildren(...data.videos.filter(video => /^[\w-]{11}$/.test(video.id)).map(card));
      section.hidden = false;
      const more = section.querySelector('[data-references-more]');
      if (more) more.hidden = false;
      if (location.hash === '#referenzen') requestAnimationFrame(() => section.scrollIntoView({ behavior: 'auto', block: 'start' }));
    } else if (all) {
      document.querySelector('[data-references-empty]').hidden = false;
    }
  } catch (error) {
    if (all) {
      const empty = document.querySelector('[data-references-empty]');
      empty.textContent = error.message;
      empty.hidden = false;
    }
  }
}

if (all) {
  const menu = document.querySelector('.menu');
  menu?.addEventListener('click', () => {
    const expanded = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(expanded));
    menu.setAttribute('aria-label', expanded ? 'Menü schließen' : 'Menü öffnen');
    document.querySelector('.site-header nav').classList.toggle('open', expanded);
  });
}
