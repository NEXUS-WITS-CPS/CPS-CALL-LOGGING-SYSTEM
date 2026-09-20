// Minimal in-memory stand-in for the Supabase client (enough for the routes' queries)
const tables = { users:[], incidents:[], audit_trail:[], notifications:[], escalations:[], confirmations:[], resolution_notes:[], categories:[], locations:[] };
const idcol = { users:'user_id', incidents:'incident_id', audit_trail:'audit_id', notifications:'notification_id', escalations:'escalation_id', confirmations:'confirmation_id', resolution_notes:'note_id' };
const seq = {};
class Q {
  constructor(t){ this.t=t; this.f=[]; this.op='select'; this.lim=null; this.ord=null; this.one=false; this.opts={}; this.payload=null; }
  select(cols, opts){ if(this.op==='select'||true){ this.opts=opts||{}; } if(this.op==='select') this.op='select'; this.ret=true; return this; }
  insert(p){ this.op='insert'; this.payload=p; return this; }
  update(p){ this.op='update'; this.payload=p; return this; }
  eq(c,v){ this.f.push(r=>r[c]===v || String(r[c])===String(v)); return this; }
  in(c,a){ this.f.push(r=>a.includes(r[c])); return this; }
  lt(c,v){ this.f.push(r=>r[c]!=null && new Date(r[c])<new Date(v)); return this; }
  not(c,op,v){ this.f.push(r=>r[c]!==null && r[c]!==undefined); return this; }
  gte(){return this;} lte(){return this;}
  order(c,o){ this.ord=[c,(o&&o.ascending===false)?-1:1]; return this; }
  limit(n){ this.lim=n; return this; }
  single(){ this.one=true; return this; }
  then(res, rej){ try { res(this.run()); } catch(e){ rej? rej(e): res({data:null,error:{message:e.message}}); } }
  run(){
    const rows = tables[this.t];
    if (this.op==='insert'){
      const arr = Array.isArray(this.payload)? this.payload : [this.payload];
      const out=[];
      for (const p of arr){
        const col=idcol[this.t]; seq[this.t]=(seq[this.t]||1000)+1;
        const row={ ...p }; if(col && row[col]==null) row[col]=seq[this.t];
        if (this.t==='incidents' && rows.some(r=>r.ticket_number===row.ticket_number)) return {data:null,error:{code:'23505',message:'duplicate'}};
        rows.push(row); out.push(row);
      }
      return this.finish(out);
    }
    let m = rows.filter(r=>this.f.every(fn=>fn(r)));
    if (this.op==='update'){ m.forEach(r=>Object.assign(r,this.payload)); return this.finish(m); }
    if (this.ord) m=[...m].sort((a,b)=>(a[this.ord[0]]>b[this.ord[0]]?1:-1)*this.ord[1]);
    if (this.lim) m=m.slice(0,this.lim);
    if (this.opts.head) return {data:null,error:null,count:m.length};
    return this.finish(m,m.length);
  }
  finish(m,count){
    if(this.one) return m.length? {data:m[0],error:null}: {data:null,error:{message:'no rows'}};
    return {data:m.map(r=>({...r})),error:null,count};
  }
}
module.exports = { from:t=>new Q(t), tables };
