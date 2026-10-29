async function dump(page) {
  return page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const f = [...document.querySelectorAll('input,select,textarea,button,a[href]')].filter(vis).map(e => {
      const lab = (e.labels && e.labels[0] ? e.labels[0].innerText : '') || e.getAttribute('aria-label') || '';
      return `${e.tagName}/${e.type||''}|fc=${e.getAttribute('formcontrolname')||e.name||''}|lab=${lab.trim().replace(/\s+/g,' ').slice(0,50)}|ph=${e.placeholder||''}|req=${e.required||e.getAttribute('aria-required')||''}|ac=${e.autocomplete||''}|val=${e.tagName==='SELECT'? (e.selectedOptions[0]?.text||'') : (e.value||'').slice(0,30)}|txt=${e.tagName!=='SELECT'? (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,40):''}|dis=${e.disabled}`;
    });
    const main = (document.querySelector('main') || document.body).innerText.replace(/\n{2,}/g, '\n').slice(0, 1500);
    return { f, main };
  });
}
module.exports = { dump };
