const rows=require('./log-rows.json');const m=new Map();for(const r of rows){if(r.length>=5)m.set(r.join('|'),r);}
const a=[...m.values()];console.log('logs unicos',a.length);
const ip={};const user=new Set();
for(const r of a){const u=r[1].replace(' Pesquisar','');const i=r[3].replace(' Pesquisar','');user.add(u);(ip[i]=ip[i]||new Set()).add(u);}
const multi=Object.entries(ip).filter(([k,v])=>v.size>1).map(([k,v])=>v.size).sort((x,y)=>y-x);
console.log('usuarios',user.size,'ips',Object.keys(ip).length,'ips com >1 usuario',multi.length,multi.slice(0,10));
const st={};for(const r of a)st[r[2]]=(st[r[2]]||0)+1;console.log(st);
const uc={};for(const r of a){const u=r[1].replace(' Pesquisar','');uc[u]=(uc[u]||0)+1}console.log('max logins por usuario',Object.values(uc).sort((x,y)=>y-x).slice(0,5));
const dev={};for(const r of a){const d=r[4].match(/^(.*?) OS:/);const k=d?d[1]:'?';dev[k]=(dev[k]||0)+1}
console.log(Object.entries(dev).sort((x,y)=>y[1]-x[1]).slice(0,6));
// UF
const uf={};for(const r of a){const d=r[4].match(/Localização: (.*)$/);const k=d?d[1]:'?';uf[k]=(uf[k]||0)+1}console.log(Object.entries(uf).sort((x,y)=>y[1]-x[1]).slice(0,8));
console.log('datas',a[a.length-1][0],a[0][0]);
