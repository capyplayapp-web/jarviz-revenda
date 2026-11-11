const rows=require('./rev-rows.json');
const m=new Map();for(const r of rows){if(r.length>=5)m.set(r[0],r);}
const a=[...m.values()];console.log('unicos',a.length);
const cnt={};const inc=(k)=>cnt[k]=(cnt[k]||0)+1;
let neg=0,zero=0,pos=0,link=0,linkPos=0; const credDist={}; const byParent={}; const linkByMonth={}; const stat={};
for(const r of a){
  const cr=parseFloat((r[1]||'').replace(/[^\d.,-]/g,'').replace(',','.'));
  if(cr<0)neg++;else if(cr===0)zero++;else pos++;
  const st=r[3];inc('st:'+st);
  const lk=/Link de Indicação/i.test(r[6]||'')||/Referral/i.test(r[6]||'');
  if(lk){link++; if(/Pós-Pago/.test(r[6]))linkPos++; const d=(r[2].match(/Criado em (\d\d)\/(\d\d)\/(\d{4})/)||[]);const k=d[3]+'-'+d[2];linkByMonth[k]=(linkByMonth[k]||0)+1;}
  const k=cr; credDist[k]=(credDist[k]||0)+1;
  byParent[r[4]]=(byParent[r[4]]||0)+1;
  const lv=(r[0].match(/Nível (\d)/)||[])[1];inc('nivel'+lv);
  const pm=r[0].match(/Revenda (Ultra|Master)|Revenda/);inc('perm:'+(pm?pm[0]:'outra'));
}
console.log({neg,zero,pos,link,linkPos},cnt,linkByMonth);
console.log(Object.entries(credDist).sort((x,y)=>y[1]-x[1]).slice(0,10));
console.log('pais (qtd por dono, sem nome):',Object.values(byParent).sort((x,y)=>y-x).slice(0,6));
const sample=a.filter(r=>!/Link de Indicação/.test(r[6]||'')).slice(0,2).map(r=>r[6]);console.log(sample);
// datas de ultimo acesso: nunca acessou?
let semAcesso=0;for(const r of a){if(/Último acesso em\s*(-|Nunca)?$/.test(r[2])||!/Último acesso/.test(r[2]))semAcesso++;}console.log('sem ultimo acesso',semAcesso);
// criados em ago/set/out
const mon={};for(const r of a){const d=(r[2].match(/Criado em (\d\d)\/(\d\d)\/(\d{4})/)||[]);const k=d[3]+'-'+d[2];mon[k]=(mon[k]||0)+1;}console.log(mon);
// mensalista vence
const ven={};for(const r of a){const d=(r[2].match(/Mensalista vence em (\d\d)\/(\d\d)\/(\d{4})/)||[]);const k=d[0]?d[3]+'-'+d[2]:'sem';ven[k]=(ven[k]||0)+1;}console.log(ven);
console.log(a.filter(r=>/Link/.test(r[6]||'')).slice(0,3).map(r=>r[6]));
