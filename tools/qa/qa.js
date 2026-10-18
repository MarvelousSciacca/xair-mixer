(() => {
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; let e = el; while (e && e !== document.documentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; e = e.parentElement; } return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
  const name = el => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase()) + (el.textContent.trim() ? ' "' + el.textContent.trim().slice(0, 18) + '"' : '');
  const out = [];
  // rettangolo realmente visibile: tagliato dai contenitori con overflow (aree che scorrono)
  const clip = el => {
    let r = el.getBoundingClientRect(); let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const p = e.getBoundingClientRect();
        box = { l: Math.max(box.l, p.left), t: Math.max(box.t, p.top), r: Math.min(box.r, p.right), b: Math.min(box.b, p.bottom) };
      }
    }
    return box;
  };
  const modal = document.querySelector('dialog[open]') || document.querySelector('.editor:not([hidden]) .editor-panel') || document.querySelector('.monitor-view:not([hidden])');
  // 1) testo che esce dal riquadro (non troncato con ellissi)
  for (const el of document.querySelectorAll('button, label, span, strong, h2, h3, div, p, dt, dd, select, option')) {
    if (!vis(el) || !el.childNodes.length) continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.writingMode.startsWith('vertical')) continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') out.push('TESTO FUORI: ' + name(el) + ` (${el.scrollWidth}>${el.clientWidth})`);
  }
  // 2) controlli sovrapposti
  const ctl = [...document.querySelectorAll('button, select, input, .knob, .choice, .sec, .meter, .fader, .pan, .db, .scribble, .mark, .eq-node, .mb-name, .mb-peak, .chip-btn, .tab')].filter(vis);
  const inScope = ctl.filter(e => !modal || modal.contains(e));
  const rs0 = inScope.map(clip);
  const keep = rs0.map(b => b.r - b.l > 2 && b.b - b.t > 2);
  const ctl2 = inScope.filter((_, i) => keep[i]); const rs = rs0.filter((_, i) => keep[i]);
  for (let i = 0; i < ctl2.length; i++) for (let j = i + 1; j < ctl2.length; j++) {
    const a = ctl2[i], b = ctl2[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (a.closest('.eq-graph') && b.closest('.eq-graph')) continue; // nodi EQ possono sovrapporsi per natura
    const ra = rs[i], rb = rs[j];
    const w = Math.min(ra.r, rb.r) - Math.max(ra.l, rb.l), h = Math.min(ra.b, rb.b) - Math.max(ra.t, rb.t);
    if (w > 2 && h > 2) {
      out.push('SOVRAPPOSTI: ' + name(a) + ' × ' + name(b) + ` (${w.toFixed(0)}x${h.toFixed(0)})`);
    }
  }
  // 3) testo tagliato dal bordo dello schermo (fuori da aree che scorrono)
  for (const el of document.querySelectorAll('button, label, span, strong, h2, h3, p, select, .tab')) {
    if (!vis(el) || (modal && !modal.contains(el))) continue;
    const b = clip(el), r = el.getBoundingClientRect();
    if (b.l !== r.left || b.r !== r.right) continue; // dentro un'area che scorre: è normale
    if (r.left < -1 || r.right > innerWidth + 1) out.push('FUORI SCHERMO: ' + name(el) + ` (${r.left.toFixed(0)}..${r.right.toFixed(0)})`);
  }
  // 4) pagina che scorre in orizzontale
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('PAGINA PIÙ LARGA DELLO SCHERMO: ' + document.documentElement.scrollWidth);
  const errs = (window.__errs || []);
  return [...new Set(out)].slice(0, 25).join('\n') + (errs.length ? '\nERRORI JS: ' + errs.join(' | ') : '') || 'nessun problema';
})()
