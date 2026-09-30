import { getDocument, GlobalWorkerOptions } from '/assets/vendor/pdfjs/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.mjs';

export function createContractPdfPreview(root) {
  const frame = root.querySelector('iframe');
  const stage = root.querySelector('[data-pdf-stage]');
  const canvas = root.querySelector('canvas');
  const pageLabel = root.querySelector('[data-pdf-page]');
  const zoomLabel = root.querySelector('[data-pdf-zoom]');
  const status = root.querySelector('[data-pdf-status]');
  let document = null;
  let loading = null;
  let rendering = null;
  let generation = 0;
  let pageNumber = 1;
  let zoom = 1.25;

  async function draw() {
    if (!document) return;
    const current = ++generation;
    if (rendering) { const previous = rendering; rendering = null; previous.cancel(); await previous.promise.catch(() => {}); }
    if (current !== generation || !document) return;
    const page = await document.getPage(pageNumber);
    if (current !== generation) return;
    const availableWidth = Math.max(280, stage.clientWidth - 28);
    const baseWidth = page.getViewport({ scale: 1 }).width;
    const scale = availableWidth / baseWidth * zoom;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * pixelRatio });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
    rendering = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
    try { await rendering.promise; }
    catch (error) { if (error?.name !== 'RenderingCancelledException') throw error; return; }
    if (current !== generation) return;
    rendering = null;
    frame.hidden = true;
    stage.hidden = false;
    pageLabel.textContent = `Seite ${pageNumber} von ${document.numPages}`;
    zoomLabel.textContent = `${Math.round(zoom * 100)} %`;
    status.textContent = '';
  }

  async function setSource(url) {
    const current = ++generation;
    if (rendering) { const previous = rendering; rendering = null; previous.cancel(); await previous.promise.catch(() => {}); }
    if (loading) { const previous = loading; loading = null; await previous.destroy(); }
    if (document) { const previous = document; document = null; await previous.destroy(); }
    if (current !== generation) return;
    status.textContent = 'PDF-Vorschau wird geladen …';
    pageNumber = 1;
    try {
      loading = getDocument({ url: url.split('#')[0] });
      const loaded = await loading.promise;
      if (current !== generation) { await loaded.destroy(); return; }
      document = loaded;
      loading = null;
      await draw();
    } catch (error) {
      if (current !== generation) return;
      stage.hidden = true;
      frame.hidden = false;
      status.textContent = 'Die vergrößerte Vorschau ist nicht verfügbar. PDF vollständig öffnen.';
    }
  }

  root.querySelector('[data-pdf-prev]').addEventListener('click', () => {
    if (document && pageNumber > 1) { pageNumber--; draw(); }
  });
  root.querySelector('[data-pdf-next]').addEventListener('click', () => {
    if (document && pageNumber < document.numPages) { pageNumber++; draw(); }
  });
  root.querySelector('[data-pdf-zoom-out]').addEventListener('click', () => {
    zoom = Math.max(.75, zoom - .25); draw();
  });
  root.querySelector('[data-pdf-zoom-in]').addEventListener('click', () => {
    zoom = Math.min(2.5, zoom + .25); draw();
  });
  root.querySelector('[data-pdf-expand]').addEventListener('click', event => {
    const expanded = root.closest('.video-contract-dialog').classList.toggle('pdf-expanded');
    event.currentTarget.setAttribute('aria-pressed', String(expanded));
    event.currentTarget.textContent = expanded ? 'Ansicht verkleinern' : 'Vorschau vergrößern';
    requestAnimationFrame(draw);
  });
  return { setSource };
}
