// Se inyecta en la página: mide estilos computados del panel activo.
window.__measure = () => {
  const root = document.querySelector('.dv-groupview.dv-active-group .dv-content-container') || document.querySelector('main') || document.body;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const cs = (e, props) => { const s = getComputedStyle(e); const o = {}; props.forEach(p => o[p] = s[p]); return o; };
  const T = ['fontFamily','fontSize','fontWeight','lineHeight','color','letterSpacing','textTransform'];
  const h = [...root.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(e => ({ tag: e.tagName, text: e.innerText.trim().slice(0,60), ...cs(e, T) }));
  const btn = [...root.querySelectorAll('button, a.btn, a[class*=button], [role=button]')].filter(vis).map(e => { const r = e.getBoundingClientRect(); return { text: (e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,40), cls: (e.className&&e.className.toString()||'').slice(0,80), h: Math.round(r.height), w: Math.round(r.width), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), ...cs(e, ['backgroundColor','color','borderRadius','fontSize','fontWeight','paddingLeft','borderTopWidth','borderTopColor','boxShadow','cursor','textTransform']) }; });
  const inp = [...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')].filter(vis).map(e => { const r = e.getBoundingClientRect(); const lab = (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || ''; return { tag: e.tagName, type: e.type, ph: e.placeholder, label: lab.trim().slice(0,40), h: Math.round(r.height), req: e.required || e.getAttribute('aria-required'), ...cs(e, ['borderRadius','fontSize','borderTopColor','backgroundColor','paddingLeft']) }; });
  const tables = [...root.querySelectorAll('table, [role=grid], [role=table]')].filter(vis).map(t => {
    const ths = [...t.querySelectorAll('th, [role=columnheader]')].map(th => ({ text: th.innerText.trim().slice(0,30), align: getComputedStyle(th).textAlign, ...cs(th, ['fontSize','fontWeight','textTransform','color','backgroundColor']) }));
    const rows = t.querySelectorAll('tbody tr, [role=row]').length;
    const td = t.querySelector('tbody td'); const tdS = td ? cs(td, ['fontSize','paddingTop','height','color']) : null;
    const money = [...t.querySelectorAll('td')].filter(c => /^[-−(]?\s*[A-Z]{0,3}\$?\s?[\d.,]+\)?$|RD\$|US\$|\$\s?\d/.test(c.innerText.trim())).slice(0,30).map(c => ({ t: c.innerText.trim(), a: getComputedStyle(c).textAlign, fv: getComputedStyle(c).fontVariantNumeric }));
    const sticky = ths[0] ? getComputedStyle(t.querySelector('th, [role=columnheader]')).position : null;
    return { ths, rows, tdS, money, sticky };
  });
  const text = root.innerText || '';
  const rawKeys = [...new Set((text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z0-9_]+){1,5}\b/g) || []).filter(k => k.includes('_') || k.split('.').length > 2).filter(k => !/\.(com|local|do|mx|co|net|org|png|pdf|csv|xlsx|json)$/.test(k)))].slice(0,30);
  const truncated = [...root.querySelectorAll('*')].filter(e => e.children.length === 0 && vis(e) && e.scrollWidth > e.clientWidth + 1 && ['hidden','clip'].includes(getComputedStyle(e).overflowX)).map(e => e.innerText.trim().slice(0,40)).filter(Boolean).slice(0,20);
  const small = [...root.querySelectorAll('*')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(e) && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.innerText.trim().slice(0,30) + '@' + getComputedStyle(e).fontSize).slice(0,15);
  const targets = [...root.querySelectorAll('button, a, input[type=checkbox], input[type=radio], [role=button], [role=tab]')].filter(vis).filter(e => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(e => ((e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||e.tagName).trim().slice(0,25)) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)).slice(0,20);
  const iconOnly = [...root.querySelectorAll('button, a, [role=button]')].filter(vis).filter(e => !e.innerText.trim() && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.getAttribute('title')).length;
  const tabEl = document.querySelector('.dv-tab.dv-active-tab, .dv-tabs-container .dv-active-tab');
  const active = [...document.querySelectorAll('nav.sidebar a')].filter(a => a.classList.contains('active') || a.getAttribute('aria-current')).map(a => a.innerText.trim());
  const crumbs = [...document.querySelectorAll('[aria-label*=igas], [aria-label*=readcrumb], nav.breadcrumb, .breadcrumb')].map(b => b.innerText.trim().replace(/\s+/g,' ')).slice(0,2);
  const emptyish = [...root.querySelectorAll('[class*=empty]')].filter(vis).map(e => ({ cls: e.className.toString().slice(0,60), text: e.innerText.trim().replace(/\s+/g,' ').slice(0,120), hasBtn: !!e.querySelector('button,a') })).slice(0,4);
  const skeleton = [...root.querySelectorAll('[class*=skeleton],[class*=spinner],[class*=loading]')].filter(vis).length;
  return { title: document.title, tab: tabEl && tabEl.innerText.trim(), active, crumbs, h, btn, inp, tables, rawKeys, truncated, small, targets, iconOnly, emptyish, skeleton, textLen: text.length, firstText: text.slice(0, 400) };
};
