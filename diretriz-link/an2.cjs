const rows=require('./rev-rows.json');const m=new Map();for(const r of rows){if(r.length>=5)m.set(r[0],r);}
const a=[...m.values()].filter(r=>/Link de Indicação/.test(r[6]||''));
const x={};for(const r of a){const d=r[2].match(/Criado em (\d\d)\/(\d\d)/);const k=d[2]+'|'+(/Inativo/.test(r[3])?'inativo':'ativo')+'|'+r[1];x[k]=(x[k]||0)+1;}
console.log(Object.entries(x).sort().slice(0,40));
// primeiro/último criado
const ds=a.map(r=>{const d=r[2].match(/Criado em (\d\d)\/(\d\d)\/(\d{4}), (\d\d:\d\d)/);return d[3]+d[2]+d[1]+d[4]});ds.sort();console.log(ds[0],ds[ds.length-1]);
const day={};for(const r of a){const d=r[2].match(/Criado em (\d\d)\/(\d\d)/);const k=d[2]+'-'+d[1];day[k]=(day[k]||0)+1}console.log(JSON.stringify(day));
const sem=[...m.values()].filter(r=>!/Link de Indicação/.test(r[6]||''));console.log(sem.length,sem.slice(0,3).map(r=>[r[1],r[2].slice(0,80),r[3]]));
const pg=a.filter(r=>/Pós-Pago/.test(r[6])).length;console.log('poposPago',pg,'outros',a.length-pg, a.filter(r=>!/Pós-Pago/.test(r[6])).slice(0,2).map(r=>r[6]));
