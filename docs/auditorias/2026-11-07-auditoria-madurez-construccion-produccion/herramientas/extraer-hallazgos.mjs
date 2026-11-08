import fs from 'node:fs'; import path from 'node:path';
const D='docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion';
const files=[...fs.readdirSync(D+'/modulos').map(f=>D+'/modulos/'+f), ...fs.readdirSync(D).filter(f=>f.endsWith('.md')&&!f.startsWith('10-')).map(f=>D+'/'+f)];
const RE=/\b(CMP|FIN|FINB|FAC|INV|NOM|TES|LOC|PLT|PLTB|IA|SP|FE|XF|DSK|CS|IAM|MFG|PRJ|CRM|POS|OBS|SEC|DB|INF|AI)(-[A-Z]{1,6})*-[A-Z]?[0-9]{1,3}[a-z]?\b/g;
const SEV=/\b(Cr[ií]tic[ao]|Alt[ao]|Medi[ao]|Baj[ao])\b/i;
const out={};
for(const f of files){const lines=fs.readFileSync(f,'utf8').split('\n');lines.forEach((l,i)=>{for(const m of l.matchAll(RE)){const id=m[0];const head=new RegExp('^\\s*(-\\s*)?\\*\\*(⚠️ )?'+id.replace(/-/g,'\\-')+'\\b').test(l);const def=head||l.includes('**'+id)||l.includes('| '+id+' |');let sev=null;if(head){const blk=[l,...lines.slice(i+1,i+6)].join(' ');const m2=blk.match(/Severidad:?\s*\*{0,2}\s*(Cr[ií]tic[ao]|Alt[ao]|Medi[ao]|Baj[ao])/i);sev=m2?m2[1]:((l.match(SEV)||[])[1]||null);}else sev=(l.match(SEV)||[])[1]||null;const rec={file:path.relative(D,f),line:i+1,text:l.trim().replace(/\s+/g,' ').slice(0,260),sev,def,head};if(!out[id])out[id]=[];out[id].push(rec);}})}
const res=Object.entries(out).map(([id,recs])=>{const pick=recs.find(r=>r.head&&r.sev)||recs.find(r=>r.def&&r.sev&&r.file.startsWith('modulos'))||recs.find(r=>r.def&&r.sev)||recs.find(r=>r.sev)||recs[0];return {id,...pick,mentions:recs.length};});
fs.writeFileSync('/tmp/claude-0/v/findings.json',JSON.stringify(res,null,1));
const c={};for(const r of res){const s=(r.sev||'?').toLowerCase().slice(0,4);c[s]=(c[s]||0)+1}console.log(res.length,c);
