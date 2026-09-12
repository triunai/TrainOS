(function(){
const K = {};
const MONO = "font-family:'JetBrains Mono', monospace";
K.C = { ink:'#181A1F', sec:'#50565F', mut:'#69717C', dis:'#A3A9B2', bd:'#E3E7EC', div:'#ECEFF3', surf:'#FAFBFC', side:'#F3F5F7', canvas:'#F7F8FA', blue:'#1F5BFF', blueT:'#1849D6', tint:'#F4F7FF', tint2:'#EBF1FF', bblue:'#CBD8FF' };
const C = K.C;

const TREE = [
 ['MAIN', [
   ['Home','⌂',[['Dashboard'],['Approvals',7],['My tasks']]],
   ['Sales','⚑',[['Enquiries'],['Leads'],['Organisations'],['Contacts'],['Pipeline'],['TNA'],['Proposals']]],
   ['Relationships','⇄',[['Renewals'],['Cross-sell'],['Marketing']]]]],
 ['OPERATIONS', [
   ['Training','▧',[['Programmes'],['Engagements'],['Calendar'],['Trainers'],['Participants'],['Assessments'],['Certificates']]],
   ['Compliance','⚖',[['HRD Corp',3],['Rules'],['Rule changes',3],['Documents'],['Deadlines']]],
   ['Finance','▬',[['Quotations'],['Invoices'],['Collections'],['Commissions'],['Profitability']]]]],
 ['KNOWLEDGE', [['Knowledge','▢',[['Library'],['Sources',1],['Templates'],['Knowledge base']]]]],
 ['SYSTEM', [
   ['Automation','⌬',[['Agents'],['Runs'],['Failures',2],['Policies']]],
   ['Reports','◫',null],
   ['Settings','⚙',[['Organisation'],['AI Models'],['Providers'],['Usage'],['Templates'],['Policies']]]]],
];
const ROLE = {
  sales:{MAIN:['Home','Sales','Relationships'],OPERATIONS:['Training'],KNOWLEDGE:['Knowledge']},
  ops:{MAIN:['Home'],OPERATIONS:['Training','Compliance'],KNOWLEDGE:['Knowledge']},
  finance:{MAIN:['Home'],OPERATIONS:['Finance','Compliance'],KNOWLEDGE:['Knowledge']},
  exec:{MAIN:['Home','Sales','Relationships'],OPERATIONS:['Finance'],SYSTEM:['Automation','Reports']},
  admin:null,
  compliance:{MAIN:['Home'],OPERATIONS:['Compliance','Finance'],KNOWLEDGE:['Knowledge']},
};
const badge = (n, alert) => `<span style="font-size:11px; font-weight:600; border-radius:999px; padding:1px 7px; ${alert?`background:#FFF0EF; color:#B4403B; border:1px solid #ECC2BF`:`background:${C.tint}; color:${C.blueT}; border:1px solid ${C.bblue}`}">${n}</span>`;

K.sidebar = function(role, active, user, userRole){
  const filt = ROLE[role]; let out = '';
  for (const [group, parents] of TREE){
    const keep = filt ? (filt[group]||[]) : parents.map(p=>p[0]);
    if (!keep.length) continue;
    out += `<div style="${MONO}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${C.mut}; margin:16px 12px 4px">${group}</div>\n`;
    for (const [label, icon, kids] of parents){
      if (!keep.includes(label)) continue;
      const hasActive = kids && kids.some(k=>k[0]===active);
      const leafActive = !kids && active===label;
      const sum = kids ? kids.reduce((a,k)=>a+(k[1]||0),0) : 0;
      const on = hasActive || leafActive;
      const right = kids ? (hasActive ? `<span style="font-size:14px; color:${C.blueT}; width:12px; text-align:center">–</span>`
        : (sum ? badge(sum, kids.some(k=>k[0]==='Failures')) : `<span style="font-size:13px; color:#7B828C; width:12px; text-align:center">›</span>`)) : '';
      out += `<div style="margin:0 12px; height:36px; border-radius:8px; display:flex; align-items:center; padding:0 8px; ${on?`background:${C.tint2}; color:${C.blueT}; font-weight:600;`:`color:${C.ink}; font-weight:500;`} font-size:14px">
  <span style="width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0">${icon}</span>
  <span style="margin-left:10px">${label}</span><span style="margin-left:auto">${right}</span></div>\n`;
      if (hasActive){
        out += `<div style="position:relative; padding-top:2px"><div style="position:absolute; left:29px; top:0; bottom:17px; width:1px; background:#CDD3DB"></div>\n`;
        out += kids.map(([k,b])=>{
          const isOn = k===active; const pill = b ? badge(b, k==='Failures') : '';
          return isOn
            ? `<div style="position:relative; margin:0 12px 0 42px; height:34px; border-radius:8px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.06); display:flex; align-items:center; padding:0 8px 0 7px"><span style="width:6px; height:6px; border-radius:999px; background:${C.blue}; flex-shrink:0"></span><span style="margin-left:11px; font-size:14px; font-weight:600; color:${C.ink}">${k}</span><span style="margin-left:auto">${pill}</span></div>`
            : `<div style="height:34px; display:flex; align-items:center; padding:0 12px 0 49px"><span style="width:6px; height:6px; border-radius:999px; background:${C.dis}; flex-shrink:0"></span><span style="margin-left:11px; font-size:14px; color:${C.sec}">${k}</span><span style="margin-left:auto">${pill}</span></div>`;
        }).join('\n') + `\n</div>\n`;
      }
    }
  }
  const initials = user.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<div style="width:240px; flex-shrink:0; display:flex; flex-direction:column">
  <div style="padding:14px 12px 6px; display:flex; align-items:center; gap:10px">
    <div style="width:26px; height:26px; border-radius:7px; background:${C.div}; border:1px solid #D5DAE1"></div>
    <div style="min-width:0"><div style="font-size:13px; font-weight:600">Akademi Perdana</div><div style="${MONO}; font-size:10px; letter-spacing:0.06em; color:${C.mut}">APSB · TRAINOS</div></div>
    <div style="margin-left:auto; display:flex; gap:8px; color:${C.mut}; font-size:12px"><span>⇄</span><span>◧</span></div>
  </div>
  <div style="flex:1; overflow:hidden; display:flex; flex-direction:column">${out}</div>
  <div style="margin-top:auto; border-top:1px solid ${C.bd}; padding:10px 12px; display:flex; align-items:center; gap:9px">
    <div style="width:28px; height:28px; border-radius:999px; background:${C.ink}; color:#fff; font-size:11px; font-weight:600; display:flex; align-items:center; justify-content:center">${initials}</div>
    <div style="min-width:0"><div style="font-size:13px; font-weight:500">${user}</div><div style="font-size:11px; color:${C.mut}">${userRole}</div></div>
    <div style="margin-left:auto; display:flex; align-items:center; border:1px solid ${C.bd}; border-radius:999px; background:#fff; padding:2px"><span style="font-size:10px; padding:1px 6px; border-radius:999px; background:${C.surf}">☀</span><span style="font-size:10px; padding:1px 6px; color:${C.mut}">☾</span></div>
  </div>
</div>`;
};

K.topbar = function(crumbs, initials){
  const parts = crumbs.map((c,i)=> i===crumbs.length-1 ? `<span style="color:${C.ink}; font-weight:500">${c}</span>` : `<a href="#" style="color:${C.sec}">${c}</a><span style="color:${C.mut}">›</span>`).join(' ');
  return `<div style="height:56px; flex-shrink:0; display:flex; align-items:center; gap:12px; padding:0 20px 0 4px">
  <div style="font-size:13px; display:flex; align-items:center; gap:7px">${parts}</div>
  <div style="margin-left:auto; display:flex; align-items:center; gap:10px">
    <div style="width:180px; border:1px solid ${C.bd}; border-radius:8px; padding:5px 9px; font-size:13px; color:${C.mut}; display:flex; align-items:center; gap:7px; background:#fff">⌕ Search<span style="margin-left:auto; ${MONO}; font-size:11px; border:1px solid ${C.bd}; border-radius:4px; padding:0 5px">⌘K</span></div>
    <div style="position:relative; color:${C.sec}"><span style="display:block; width:15px; height:14px; border:1.5px solid ${C.sec}; border-radius:8px 8px 3px 3px; opacity:.75"></span><span style="position:absolute; top:-4px; right:-6px; font-size:10px; font-weight:600; background:#FFF0EF; color:#B4403B; border:1px solid #ECC2BF; border-radius:999px; padding:0 4px">4</span></div>
    <div style="font-size:12px; color:${C.sec}; border:1px solid ${C.bd}; border-radius:6px; padding:3px 8px">EN <span style="color:${C.mut}">| BM</span></div>
    <div style="width:28px; height:28px; border-radius:999px; background:${C.ink}; color:#fff; font-size:11px; font-weight:600; display:flex; align-items:center; justify-content:center">${initials}</div>
  </div>
</div>`;
};

K.btn = (t, kind) => kind==='primary'
  ? `<button style="font-family:inherit; font-size:13px; font-weight:600; padding:8px 16px; border-radius:8px; border:1px solid ${C.blue}; background:${C.blue}; color:#fff; cursor:pointer; white-space:nowrap">${t}</button>`
  : kind==='danger'
  ? `<button style="font-family:inherit; font-size:13px; font-weight:500; padding:8px 14px; border-radius:8px; border:1px solid ${C.bd}; background:#fff; color:#B4403B; cursor:pointer; white-space:nowrap">${t}</button>`
  : kind==='ghost'
  ? `<button style="font-family:inherit; font-size:13px; font-weight:500; padding:8px 12px; border-radius:8px; border:1px solid transparent; background:transparent; color:${C.sec}; cursor:pointer; white-space:nowrap">${t}</button>`
  : `<button style="font-family:inherit; font-size:13px; font-weight:500; padding:8px 14px; border-radius:8px; border:1px solid ${C.bd}; background:#fff; color:${C.ink}; cursor:pointer; white-space:nowrap">${t}</button>`;

K.chip = (t, kind) => {
  const m = { neutral:`background:${C.side}; color:${C.sec}; border:1px solid ${C.bd}`,
    ok:'background:#ECF6F0; color:#2B7153; border:1px solid #BFDCCB',
    warn:'background:#FFF7E8; color:#966119; border:1px solid #ECD29C',
    danger:'background:#FFF0EF; color:#B4403B; border:1px solid #ECC2BF',
    info:'background:#EFF3F7; color:#466487; border:1px solid #CBD7E3',
    ai:`background:${C.tint}; color:${C.blueT}; border:1px solid ${C.bblue}` };
  return `<span style="font-size:12px; font-weight:500; padding:3px 9px; border-radius:999px; ${m[kind||'neutral']}; white-space:nowrap">${t}</span>`;
};
K.lbl = (t) => `<div style="${MONO}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${C.mut}; white-space:nowrap">${t}</div>`;

K.cell = function(label, value, o){
  o = o || {};
  const val = o.bar!=null
    ? `<div style="display:flex; align-items:center; gap:8px"><div style="width:64px; height:6px; border-radius:999px; background:${C.div}; overflow:hidden"><div style="width:${o.bar}%; height:100%; background:${o.barColor||C.ink}"></div></div><span style="font-size:16px; font-weight:600">${value}</span></div>`
    : `<div style="font-size:16px; font-weight:600; ${o.mono===false?'':MONO+';'} color:${o.color||C.ink}; letter-spacing:-0.01em; white-space:nowrap">${value}</div>`;
  return `<div ${o.act?'tabindex="0" ':''}style="padding:2px 16px 2px ${o.act?'8px':'0'}; ${o.act?'margin-left:-8px; border-radius:8px; cursor:pointer;':''} display:flex; flex-direction:column; gap:3px">
  ${K.lbl(label)}${val}${o.sub?`<div style="font-size:12px; color:${o.subColor||C.mut}; white-space:nowrap">${o.sub}</div>`:''}</div>`;
};
K.strip = (cells) => `<div style="display:flex; align-items:stretch; flex-wrap:wrap; row-gap:10px; border-top:1px solid ${C.div}; padding:12px 0 2px">${cells.map((c,i)=>`${i?`<div style="width:1px; background:${C.bd}; margin:2px 20px 2px 4px"></div>`:''}${c}`).join('')}</div>`;

K.recordHeader = (name, chips, meta, cells, actions) => `<div style="padding:20px 20px 16px; display:flex; flex-direction:column; gap:14px">
  <div style="display:flex; align-items:center; gap:10px; min-height:36px">
    <div style="font-size:22px; font-weight:600; letter-spacing:-0.015em; white-space:nowrap">${name}</div>${chips}
    <div style="margin-left:auto; display:flex; gap:8px; flex-shrink:0">${actions}</div>
  </div>
  <div style="${MONO}; font-size:11px; letter-spacing:0.01em; color:#7B828C; margin-top:-6px">${meta}</div>
  ${cells && cells.length ? K.strip(cells) : ''}
</div>`;

K.pageHeader = (title, chip, actions) => `<div style="padding:20px 20px 14px; display:flex; align-items:center; gap:10px; min-height:36px">
  <div style="font-size:22px; font-weight:600; letter-spacing:-0.015em">${title}</div>${chip||''}
  <div style="margin-left:auto; display:flex; gap:8px">${actions||''}</div></div>`;

K.pills = function(items){
  const one = (t,c,on,dg) => `<div style="display:flex; align-items:center; gap:6px; height:28px; padding:0 12px; border-radius:999px; font-size:13px; ${on?`background:#fff; color:${C.blueT}; font-weight:600; box-shadow:0 1px 2px rgba(0,0,0,.05);`:`color:${C.sec};`}">${t}${c?`<span style="font-size:12px; ${on?`color:${C.blueT}`:(dg?'color:#B4403B':`color:${C.mut}`)}">${c}</span>`:''}</div>`;
  return `<div style="display:inline-flex; align-items:center; gap:2px; background:${C.side}; border:1px solid ${C.bd}; border-radius:999px; padding:3px">${items.map(i=>one(i[0],i[1],i[2],i[3])).join('')}</div>`;
};

K.table = function(cols, rows, o){
  o = o || {};
  const p = o.dense ? '7px 12px' : '10px 12px';
  const th = cols.map(c=>`<th style="text-align:${c.right?'right':'left'}; padding:8px 12px; ${MONO}; font-size:10px; letter-spacing:0.06em; text-transform:uppercase; color:${C.mut}; font-weight:500; background:${C.surf}; border-bottom:1px solid ${C.bd}; white-space:nowrap">${c.t}</th>`).join('');
  const tr = rows.map((r,i)=>`<tr style="${r.sel?`background:${C.tint2}; box-shadow:inset 2px 0 0 ${C.blue};`:(i%2?`background:${C.surf};`:'')} border-bottom:1px solid ${C.div}">${r.c.map((cd,j)=>`<td style="padding:${p}; ${cols[j].right?'text-align:right; '+MONO+';':''} ${cols[j].nowrap?'white-space:nowrap;':''} font-size:13px; color:${C.ink}">${cd}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%; border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
};

K.section = (title, body, right) => `<div style="display:flex; flex-direction:column; gap:10px">
  <div style="display:flex; align-items:baseline; gap:10px">${K.lbl(title)}${right?`<div style="margin-left:auto; font-size:12px">${right}</div>`:''}</div>${body}</div>`;

K.ai = (title, body, meta) => `<div style="border:1px solid ${C.bblue}; border-radius:10px; overflow:hidden">
  <div style="background:${C.tint}; padding:8px 12px; display:flex; align-items:center; gap:8px; border-bottom:1px solid ${C.bblue}">
    <span style="font-size:12px; font-weight:600; color:${C.blueT}">✦ ${title}</span>${meta?`<span style="margin-left:auto; font-size:12px; color:${C.blueT}">${meta}</span>`:''}
  </div><div style="padding:12px">${body}</div></div>`;

K.banner = (kind, title, sub, action) => {
  const m = { danger:'border:1px solid #ECC2BF; background:#FFF0EF', warn:'border:1px solid #ECD29C; background:#FFF7E8', info:'border:1px solid #CBD7E3; background:#EFF3F7', neutral:`border:1px solid ${C.bd}; background:${C.surf}` };
  return `<div style="${m[kind]}; border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:12px">
  <div style="flex:1"><div style="font-size:13px; font-weight:600">${title}</div><div style="font-size:12px; color:${C.sec}">${sub}</div></div>${action||''}</div>`;
};

K.fab = `<div style="position:absolute; right:24px; bottom:24px; width:44px; height:44px; border-radius:999px; background:${C.tint}; border:1px solid ${C.bblue}; color:${C.blueT}; font-size:17px; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 2px rgba(0,0,0,.06)" title="Ask TrainOS">✦</div>`;
K.aiPill = `<div style="align-self:flex-start; display:flex; align-items:center; gap:7px; height:32px; padding:0 12px; border-radius:999px; background:${C.tint}; border:1px solid ${C.bblue}; color:${C.blueT}; font-size:12px; font-weight:500">✦ Ask TrainOS</div>`;

K.screen = function(o){
  // o: id, code, title, subtitle, role, active, crumbs, user, userRole, initials, body, fab(bool), annotation
  const shell = o.external
    ? `<div style="flex:1; min-width:0; display:flex; flex-direction:column">
  <div style="height:56px; flex-shrink:0; display:flex; align-items:center; gap:12px; padding:0 24px">
    <div style="width:24px; height:24px; border-radius:7px; background:${C.div}; border:1px solid #D5DAE1"></div>
    <div style="font-size:13px; font-weight:600">Akademi Perdana</div>
    <div style="margin-left:auto; display:flex; align-items:center; gap:10px"><div style="font-size:12px; color:${C.sec}; border:1px solid ${C.bd}; border-radius:6px; padding:3px 8px">EN <span style="color:${C.mut}">| BM</span></div><div style="font-size:12px; color:${C.sec}">Nurul Hassan · Aurora</div></div>
  </div>
  <div style="flex:1; min-height:0; margin:0 14px 14px; background:#fff; border:1px solid ${C.bd}; border-radius:14px; box-shadow:0 1px 2px rgba(0,0,0,.04); display:flex; flex-direction:column; overflow:hidden; position:relative">${o.body}${o.fab===false?'':K.fab}</div></div>`
    : `${K.sidebar(o.role, o.active, o.user, o.userRole)}
<div style="flex:1; min-width:0; display:flex; flex-direction:column">
  ${K.topbar(o.crumbs, o.initials)}
  <div style="flex:1; min-height:0; margin:0 14px 14px 0; background:#fff; border:1px solid ${C.bd}; border-radius:14px; box-shadow:0 1px 2px rgba(0,0,0,.04); display:flex; flex-direction:column; overflow:hidden; position:relative">${o.body}${o.fab===false?'':K.fab}</div>
</div>`;
  const a = o.annotation || {};
  const ann = `<details style="width:1440px; border:1px solid ${C.bd}; border-radius:12px; background:#fff">
  <summary style="padding:12px 16px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:8px"><span style="${MONO}; font-size:10px; color:${C.mut}">▸</span>Annotation &amp; handoff · ${o.code}</summary>
  <div style="padding:0 16px 16px; display:grid; grid-template-columns:repeat(3,1fr); gap:16px; font-size:12px; color:${C.sec}; line-height:1.6">
    <div><b style="color:${C.ink}">Purpose</b><br>${a.purpose||''}</div>
    <div><b style="color:${C.ink}">Primary user</b><br>${a.user||''}</div>
    <div><b style="color:${C.ink}">Components used</b><br>${a.components||''}</div>
    <div><b style="color:${C.ink}">Data contract</b><br><span style="${MONO}; font-size:11px; color:${C.ink}">${a.data||''}</span></div>
    <div><b style="color:${C.ink}">Actions &amp; policy gates</b><br>${a.actions||''}</div>
    <div><b style="color:${C.ink}">States rendered</b><br>${a.states||''}</div>
    <div><b style="color:${C.ink}">AI &amp; approval behaviour</b><br>${a.ai||''}</div>
    <div><b style="color:${C.ink}">Wired to</b><br>${a.wired||''}</div>
    <div><b style="color:${C.ink}">Assumptions</b><br>${a.assume||''}</div>
  </div></details>`;
  return `<div id="${o.id}" style="display:flex; flex-direction:column; gap:10px">
  <div style="display:flex; align-items:baseline; gap:10px">
    <span style="${MONO}; font-size:11px; letter-spacing:0.06em; color:#fff; background:${C.ink}; padding:3px 8px; border-radius:4px">${o.code}</span>
    <span style="font-size:15px; font-weight:600">${o.title}</span>
    <span style="font-size:13px; color:${C.mut}">${o.subtitle||''}</span>
  </div>
  <div style="width:1440px; height:900px; background:${C.side}; border:1px solid ${C.bd}; border-radius:12px; overflow:hidden; display:flex">${shell}</div>
  ${ann}
</div>`;
};

// ---- update pass: AI operations components ----
K.tierChip = (tier, model) => `<span style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:500; padding:3px 9px; border-radius:6px; background:${C.surf}; border:1px solid ${C.bd}; color:${C.sec}; white-space:nowrap"><span style="${MONO}; font-size:10px; letter-spacing:0.06em; color:${C.ink}">${tier}</span>${model?`<span style="color:${C.mut}">${model}</span>`:''}</span>`;
K.juryChip = (on) => on
  ? `<span style="font-size:12px; font-weight:500; padding:3px 9px; border-radius:999px; background:${C.tint}; color:${C.blueT}; border:1px solid ${C.bblue}; white-space:nowrap">✦ Jury 2 of 3</span>`
  : `<span style="font-size:12px; padding:3px 9px; border-radius:999px; background:${C.surf}; color:${C.mut}; border:1px solid ${C.bd}; white-space:nowrap">No jury</span>`;
K.budgetBar = (spent, cap, pct, kind) => {
  const col = kind==='danger' ? '#B4403B' : kind==='warn' ? '#B67422' : C.ink;
  return `<div style="display:flex; flex-direction:column; gap:5px; min-width:150px">
  <div style="display:flex; justify-content:space-between; font-size:12px"><span style="color:${C.sec}">${spent}</span><span style="${MONO}; color:${C.mut}">of ${cap}</span></div>
  <div style="height:5px; border-radius:999px; background:${C.div}; overflow:hidden"><div style="width:${pct}%; height:100%; background:${col}"></div></div></div>`;
};
K.ruleChip = (id) => `<span style="display:inline-flex; align-items:center; gap:5px; ${MONO}; font-size:11px; padding:2px 7px; border-radius:5px; background:#fff; border:1px solid ${C.bd}; color:${C.sec}; white-space:nowrap">§ ${id}</span>`;
K.checkRow = (state, label, computed, ruleId) => {
  const m = { pass:['#ECF6F0','#2B7153','#BFDCCB','Pass'], fail:['#FFF0EF','#B4403B','#ECC2BF','Fail'], warn:['#FFF7E8','#966119','#ECD29C','Warn'] }[state];
  return `<div style="display:flex; align-items:flex-start; gap:12px; padding:9px 0; border-top:1px solid ${C.div}">
  <span style="font-size:12px; font-weight:500; padding:2px 9px; border-radius:999px; background:${m[0]}; color:${m[1]}; border:1px solid ${m[2]}; flex-shrink:0">${m[3]}</span>
  <div style="min-width:0; flex:1"><div style="font-size:13px; color:${C.ink}">${label}</div><div style="font-size:12px; color:${C.mut}; ${MONO}; padding-top:2px">${computed}</div></div>
  ${K.ruleChip(ruleId)}</div>`;
};
K.hours = (bands) => `<div style="display:flex; height:22px; border:1px solid ${C.bd}; border-radius:5px; overflow:hidden; min-width:220px">
  ${Array.from({length:24},(_,h)=>{ const b = bands.find(x=>h>=x[0]&&h<x[1]); const bg = b ? (b[2]==='peak'?'#F3E3C6':(b[2]==='allowed'?C.tint2:C.div)) : '#fff';
    return `<div title="${h}:00" style="flex:1; background:${bg}; border-right:${h<23?`1px solid ${C.div}`:'none'}"></div>`; }).join('')}
</div>`;
K.stateCard = (rows) => `<div style="display:flex; flex-direction:column; gap:14px">${rows.map(r=>`<div style="display:flex; flex-direction:column; gap:6px">${K.lbl(r[0])}<div style="font-size:13px; color:${C.ink}; line-height:1.55">${r[1]}</div></div>`).join('')}</div>`;
K.treeNode = (depth, glyph, glyphColor, title, meta, right, o) => {
  o = o || {};
  return `<div style="display:flex; gap:10px; padding:9px 0 9px ${depth*22}px; border-top:1px solid ${C.div}; ${o.bg?`background:${o.bg};`:''}">
  ${depth?`<span style="width:12px; color:${C.dis}; ${MONO}; font-size:11px">└</span>`:''}
  <span style="color:${glyphColor}; width:14px; text-align:center; ${MONO}; font-size:13px; flex-shrink:0">${glyph}</span>
  <div style="min-width:0; flex:1"><div style="font-size:13px; font-weight:${depth?400:600}; color:${C.ink}">${title}</div><div style="font-size:12px; color:${C.mut}; padding-top:2px">${meta}</div></div>
  <div style="${MONO}; font-size:11px; color:${C.mut}; white-space:nowrap; text-align:right">${right}</div>
  <span style="color:${C.dis}; font-size:12px">▸</span></div>`;
};

K.file = function(title, intro, screens){
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<meta name="design_doc_mode" content="canvas">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  body { margin:0; background:${C.surf}; font-family:Inter, system-ui, sans-serif; color:${C.ink}; -webkit-font-smoothing:antialiased; }
  a { color:${C.blue}; text-decoration:none; }
  a:hover { color:${C.blueT}; text-decoration:underline; }
  details > summary { list-style:none; cursor:pointer; }
  details > summary::-webkit-details-marker { display:none; }
</style>
</helmet>
<div style="padding:48px 40px 96px; display:flex; flex-direction:column; gap:48px; align-items:flex-start">
  <div style="display:flex; flex-direction:column; gap:8px; max-width:760px">
    <div style="${MONO}; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:${C.mut}">TrainOS · demo pack</div>
    <div style="font-size:26px; font-weight:600; letter-spacing:-0.02em">${title}</div>
    <div style="font-size:14px; color:${C.sec}; line-height:1.55">${intro}</div>
  </div>
${screens.join('\n\n')}
</div>
</x-dc>
</body>
</html>
`;
};
return K;
})()
