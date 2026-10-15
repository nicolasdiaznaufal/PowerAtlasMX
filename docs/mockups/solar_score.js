const C=['land','resource','market','congestion','terrain','grid'];
const NAME={land:'Land',resource:'Solar resource',market:'Market price',congestion:'Congestion',terrain:'Terrain',grid:'Grid proximity'};
const W0=D.meta.config.weights,W={...W0};let MODE=D.meta.config.mode_default,SEL=null,HOVER=null;
const f=(x,d=0)=>x==null?'n/a':Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
const $=id=>document.getElementById(id);
const norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function score(n){if(!n.components)return null;const tw=C.reduce((a,c)=>a+W[c],0);if(!tw)return null;
  if(MODE==='linear')return 100*C.reduce((a,c)=>a+W[c]*n.components[c],0)/tw;
  return 100*Math.exp(C.reduce((a,c)=>a+W[c]*Math.log(Math.max(n.components[c],.02)),0)/tw)}
// ---- geometry (same decoding and projection as web/v2)
const P=GEO.proj,S=GEO.scale;
function ring(flat){const o=[];let x=0,y=0;for(let i=0;i<flat.length;i+=2){x+=flat[i];y+=flat[i+1];o.push([x/S,y/S])}return o}
const px=(lon,lat)=>[(lon-P.lon0)*P.sx+(P.x0||0),(P.lat0-lat)*P.sy];
const states=GEO.states.map(s=>{const rs=s.r.map(ring),p=new Path2D();let b=[1e9,1e9,-1e9,-1e9];
  rs.forEach(r=>{r.forEach(([x,y],i)=>{i?p.lineTo(x,y):p.moveTo(x,y);b=[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)]});p.closePath()});
  return{k:s.k,n:s.n,c:s.c,path:p,bbox:b}});
const regionPath={};for(const[k,rs]of Object.entries(GEO.regions)){const p=new Path2D();
  rs.forEach(fl=>{ring(fl).forEach(([x,y],i)=>i?p.lineTo(x,y):p.moveTo(x,y));p.closePath()});regionPath[k]=p}
const regionBox={};states.forEach(s=>{const b=regionBox[s.c]||(regionBox[s.c]=[1e9,1e9,-1e9,-1e9]);
  b[0]=Math.min(b[0],s.bbox[0]);b[1]=Math.min(b[1],s.bbox[1]);b[2]=Math.max(b[2],s.bbox[2]);b[3]=Math.max(b[3],s.bbox[3])});
D.nodes.forEach(n=>{[n.x,n.y]=px(n.lon,n.lat)});
// ---- canvas + view
const cv=$('cv'),ctx=cv.getContext('2d');let V={k:1,tx:0,ty:0},DPR=1;
const ALL=[1e9,1e9,-1e9,-1e9];states.forEach(s=>{ALL[0]=Math.min(ALL[0],s.bbox[0]);ALL[1]=Math.min(ALL[1],s.bbox[1]);ALL[2]=Math.max(ALL[2],s.bbox[2]);ALL[3]=Math.max(ALL[3],s.bbox[3])});
function fit(b,pad=40){const w=cv.clientWidth,h=cv.clientHeight,left=w>900?340:0,right=w>900?360:0;
  const aw=Math.max(w-left-right-2*pad,100),ah=h-2*pad;const k=Math.min(aw/(b[2]-b[0]),ah/(b[3]-b[1]));
  V={k,tx:left+pad+(aw-(b[2]-b[0])*k)/2-b[0]*k,ty:pad+(ah-(b[3]-b[1])*k)/2-b[1]*k}}
const lerp=(a,b,t)=>a+(b-a)*t,RAMP=[[30,43,35],[79,107,90],[237,230,208]];
function col(v){const t=Math.max(0,Math.min(1,v/80)),a=t<.5?[RAMP[0],RAMP[1],t*2]:[RAMP[1],RAMP[2],(t-.5)*2];
  return`rgb(${a[0].map((x,i)=>Math.round(lerp(x,a[1][i],a[2]))).join(',')})`}
const inSel=n=>!SEL||SEL.kind==='node'?true:SEL.kind==='state'?n.state===SEL.id:n.region===SEL.id;
function draw(){DPR=window.devicePixelRatio||1;const w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==w*DPR||cv.height!==h*DPR){cv.width=w*DPR;cv.height=h*DPR}
  ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,w,h);
  ctx.save();ctx.translate(V.tx,V.ty);ctx.scale(V.k,V.k);ctx.lineJoin='round';
  states.forEach(s=>{const on=SEL&&((SEL.kind==='state'&&SEL.id===s.k)||(SEL.kind==='region'&&SEL.id===s.c));
    ctx.fillStyle=on?'#18211B':'#111813';ctx.fill(s.path);
    ctx.lineWidth=(on?2:1)/V.k;ctx.strokeStyle=on?'rgba(232,162,102,.9)':'rgba(240,232,210,.14)';ctx.stroke(s.path)});
  ctx.lineWidth=1.5/V.k;ctx.strokeStyle='rgba(240,232,210,.36)';Object.values(regionPath).forEach(p=>ctx.stroke(p));
  const r=Math.max(2.2,Math.min(9,2.5*V.k/1.0))/V.k;
  const dot=(n,a)=>{const s=score(n);ctx.globalAlpha=a;ctx.fillStyle=s==null?'#3A453E':col(s);ctx.beginPath();
    ctx.arc(n.x,n.y,s==null?r*.7:r,0,7);ctx.fill()};
  D.nodes.forEach(n=>{if(score(n)==null)dot(n,inSel(n)?.8:.25)});
  D.nodes.forEach(n=>{if(score(n)!=null)dot(n,inSel(n)?.95:.22)});
  ctx.globalAlpha=1;ctx.lineWidth=2/V.k;ctx.strokeStyle='#E8A266';
  [SEL&&SEL.kind==='node'?D.nodes.find(n=>n.id===SEL.id):null,HOVER].forEach(n=>{if(n){ctx.beginPath();ctx.arc(n.x,n.y,r*1.8,0,7);ctx.stroke()}});
  ctx.restore()}
// ---- interaction
let drag=null;
cv.onmousedown=e=>{drag={x:e.clientX,y:e.clientY,tx:V.tx,ty:V.ty,moved:false};cv.style.cursor='grabbing'};
window.onmouseup=e=>{if(drag&&!drag.moved)pick(e);drag=null;cv.style.cursor='grab'};
window.onmousemove=e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;V.tx=drag.tx+dx;V.ty=drag.ty+dy;draw();return}
  if(e.target!==cv)return;const n=nearest(e);const tip=$('tip');
  if(n!==HOVER){HOVER=n;draw()}
  if(n){const s=score(n);tip.style.display='block';tip.style.left=e.offsetX+14+'px';tip.style.top=e.offsetY+14+'px';
    tip.textContent=`${n.nombre} · ${s==null?'not scored':s.toFixed(0)}`}else tip.style.display='none'};
cv.onwheel=e=>{e.preventDefault();const z=Math.exp(-e.deltaY*.0015),rc=cv.getBoundingClientRect(),mx=e.clientX-rc.left,my=e.clientY-rc.top;
  const nk=Math.max(.5,Math.min(60,V.k*z));V.tx=mx-(mx-V.tx)*nk/V.k;V.ty=my-(my-V.ty)*nk/V.k;V.k=nk;draw()};
function toWorld(e){const rc=cv.getBoundingClientRect();return[(e.clientX-rc.left-V.tx)/V.k,(e.clientY-rc.top-V.ty)/V.k]}
function nearest(e){const[x,y]=toWorld(e),lim=(10/V.k)**2;let b=null,bd=lim;
  D.nodes.forEach(n=>{if(!inSel(n))return;const d=(n.x-x)**2+(n.y-y)**2;if(d<bd){bd=d;b=n}});return b}
function pick(e){const n=nearest(e);if(n)return choose({kind:'node',id:n.id});
  const[x,y]=toWorld(e);const s=states.find(s=>ctx.isPointInPath(s.path,x*V.k+V.tx,y*V.k+V.ty)||false);
  if(s)choose({kind:'state',id:s.k});else choose(null)}
function choose(sel){SEL=sel;if(sel){let b=null;
  if(sel.kind==='node'){const n=D.nodes.find(n=>n.id===sel.id);fit([n.x-60,n.y-40,n.x+60,n.y+40])}
  else if(sel.kind==='state')b=states.find(s=>s.k===sel.id).bbox;else b=regionBox[sel.id];
  if(b)fit(b)}else fit(ALL);panel();draw()}
// ---- search
const ENT=[...D.nodes.map(n=>({kind:'node',id:n.id,label:n.nombre,sub:`${n.id} · ${n.entidad||''}`,key:norm(n.nombre+' '+n.id+' '+(n.municipio||''))})),
  ...states.map(s=>({kind:'state',id:s.k,label:s.n,sub:'State',key:norm(s.n)})),
  ...Object.keys(regionPath).map(k=>({kind:'region',id:k,label:k[0]+k.slice(1).toLowerCase(),sub:'Region',key:norm(k)}))];
$('q').oninput=e=>{const t=norm(e.target.value.trim());const ul=$('hits');
  if(!t){ul.innerHTML='';return}
  const rank=x=>(x.kind==='node'?2:0)+(x.key.startsWith(t)?0:1);
  const hits=ENT.filter(x=>x.key.includes(t)).sort((a,b)=>rank(a)-rank(b)).slice(0,8);
  ul.innerHTML=hits.map((x,i)=>{const s=x.kind==='node'?score(D.nodes.find(n=>n.id===x.id)):null;
    return`<li data-i="${i}"><span>${x.label}<br><span class="sub">${x.sub}</span></span><b>${s==null?'':s.toFixed(0)}</b></li>`}).join('');
  ul.querySelectorAll('li').forEach(li=>li.onclick=()=>{choose({kind:hits[+li.dataset.i].kind,id:hits[+li.dataset.i].id});ul.innerHTML='';$('q').value=''})};
// ---- controls
function controls(){$('wts').innerHTML=C.map(c=>`<div class="row"><span>${NAME[c]}</span><input type="range" min="0" max="100" value="${Math.round(W[c]*100)}" data-c="${c}"><span>${Math.round(W[c]*100)}</span></div>`).join('');
  $('wts').querySelectorAll('input').forEach(i=>i.oninput=()=>{W[i.dataset.c]=i.value/100;i.nextElementSibling.textContent=i.value;panel();draw()});
  $('mode').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.m===MODE);b.onclick=()=>{MODE=b.dataset.m;controls();panel();draw()}});
  $('modeNote').textContent=MODE==='strict'?'Weighted geometric mean: one weak component pulls the whole score down.':'Weighted average: strengths can offset weaknesses.'}
$('reset').onclick=()=>{Object.assign(W,W0);controls();panel();draw()};
// ---- detail panel
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))]};
function listHtml(rows){return`<ul class="rk">${rows.map(([n,s])=>`<li data-id="${n.id}"><span>${n.nombre}<br><span class="sub">${n.entidad||''}</span></span><b>${s.toFixed(0)}</b></li>`).join('')}</ul>`}
function panel(){const el=$('detail');let h='';
  if(SEL&&SEL.kind==='node'){const n=D.nodes.find(n=>n.id===SEL.id),s=score(n);
    h=`<h3 class="mono">${n.id}</h3><div style="font-size:18px;font-weight:500">${n.nombre}</div>
    <div class="sub">${n.municipio||''}, ${n.entidad||''} · ${n.region||''}</div>
    <div class="big" style="margin:16px 0">${s==null?'–':s.toFixed(0)}<small> / 100</small></div>
    ${n.flags.length?`<div class="flag">Not scored: ${n.flags.join(', ')}</div>`:''}
    ${n.components?C.map(c=>`<div class="bar"><div class="t"><span>${NAME[c]}</span><i>${f(n.components[c]*100)} · weight ${f(W[c]*100)}</i></div><div class="b"><div style="width:${n.components[c]*100}%"></div></div></div>`).join(''):''}
    <h3 class="mono">Raw values · 15 km circle</h3><table>
    <tr><td>Largest viable patch</td><td>${f(n.max_patch_ha)} ha</td></tr>
    <tr><td>Slope over 7 %</td><td>${f(n.steep_pct,1)} %</td></tr>
    <tr><td>Flat (≤3 %) share</td><td>${f(n.flat3_pct,1)} %</td></tr>
    <tr><td>Land cover excluded</td><td>${f(n.landcover_excl_pct,1)} %</td></tr>
    <tr><td>Protected area (federal)</td><td>${f(n.anp_excl_pct,1)} %</td></tr>
    <tr><td>Nearest 115–400 kV line</td><td>${f(n.dist_hv_line_km,1)} km</td></tr>
    <tr><td>Nearest ≤161 kV substation</td><td>${f(n.dist_substation_km,1)} km</td></tr>
    <tr><td>Solar yield (fixed tilt)</td><td>${f(n.yf_kwh_kwp)} kWh/kWp·yr</td></tr>
    <tr><td>Captured price (real, MDA)</td><td>${f(n.price_mxn_mwh)} MXN/MWh</td></tr>
    <tr><td>Congestion, solar-weighted</td><td>${f(n.cong_mxn_mwh,1)} MXN/MWh</td></tr>
    <tr><td>Months of price data</td><td>${f(n.meses)}</td></tr></table>
    <div class="sub" style="margin-top:10px">Location is the municipality centroid, not the substation.</div>
    <button class="btn" id="clr">Back to national view</button>`}
  else{const inA=D.nodes.filter(inSel),sc=inA.map(n=>[n,score(n)]).filter(x=>x[1]!=null).sort((a,b)=>b[1]-a[1]);
    const title=!SEL?'Mexico':SEL.kind==='state'?states.find(s=>s.k===SEL.id).n:SEL.id[0]+SEL.id.slice(1).toLowerCase()+' region';
    const v=sc.map(x=>x[1]);
    h=`<h3 class="mono">${SEL?SEL.kind:'National'}</h3><div style="font-size:18px;font-weight:500">${title}</div>
    <div class="sub">${inA.length} nodes · ${sc.length} scored</div>
    <div class="big" style="margin:16px 0">${v.length?f(pct(v,.5)):'–'}<small> median</small></div>
    <table><tr><td>Top 10 % of nodes score above</td><td>${f(pct(v,.9))}</td></tr>
    <tr><td>Best node</td><td>${sc[0]?sc[0][0].nombre+' · '+f(sc[0][1]):'–'}</td></tr></table>
    <h3 class="mono">Top 10 nodes</h3>${listHtml(sc.slice(0,10))}
    ${SEL?'<button class="btn" id="clr">Back to national view</button>':''}`}
  el.innerHTML=h;const b=$('clr');if(b)b.onclick=()=>choose(null);
  el.querySelectorAll('li[data-id]').forEach(li=>li.onclick=()=>choose({kind:'node',id:li.dataset.id}))}
// ---- method section
function method(){const M=D.meta,c=M.config,s=c.scales,w=c.weights;
$('method').innerHTML=`<h2>How the score is built</h2>
<p>For each PML node we study the land inside a <b>${c.buffer_km} km circle</b> around its location, add its solar resource and market behaviour, and turn six components into a 0–100 score. It ranks places to look at first. It is <b>not</b> a site approval or a financial verdict, and the weights are provisional.</p>
<h2>1 · Land screen: what is removed</h2>
<table><tr><td>Slope</td><td>Cells steeper than <code>${c.slope_max_pct} %</code>. INEGI relief model 2025 (~81 m cells, corrected for latitude). Sea ignored.</td></tr>
<tr><td>Land cover</td><td>Forest and jungle (primary and secondary), settlements, water, aquaculture, mangrove, wetland, riparian, irrigated and humidity agriculture, palm groves. Allowed: grassland, scrub, desert, rainfed agriculture. INEGI Serie VII, 1:250,000.</td></tr>
<tr><td>Protected areas</td><td>Federal natural protected areas (CONANP, 2026-09-24). State, municipal, RAMSAR and Indigenous lands are not included.</td></tr>
<tr><td>Patch</td><td>Remaining cells are joined into contiguous patches; the largest is kept. Under <code>${c.min_patch_ha} ha</code> the node receives no score.</td></tr></table>
<h2>2 · Six components, each scaled 0–1</h2>
<table>
<tr><td>Land · ${f(w.land*100)}</td><td>Largest patch, log scale: ${f(s.land_ha[0])} ha = 0, ${f(s.land_ha[1])} ha = 1.</td></tr>
<tr><td>Solar resource · ${f(w.resource*100)}</td><td>Yearly yield of a fixed-tilt plant (kWh/kWp·yr, NASA POWER via pvlib): ${f(s.resource_kwh_kwp[0])} = 0, ${f(s.resource_kwh_kwp[1])} = 1.</td></tr>
<tr><td>Market · ${f(w.market*100)}</td><td>Real MDA price captured by a solar profile at that node, ${f(M.price_scale[0])} MXN/MWh = 0 (10th percentile) to ${f(M.price_scale[1])} = 1 (90th). Reference only, not full revenue.</td></tr>
<tr><td>Congestion · ${f(w.congestion*100)}</td><td>Congestion component of the price, weighted by solar output, ${c.congestion_years[0]}–${c.congestion_years[1]}. Negative means congestion lowers the price a plant would get: ${f(M.cong_scale[0])} MXN/MWh = 0, ${f(M.cong_scale[1])} = 1 (10th–90th percentile).</td></tr>
<tr><td>Terrain · ${f(w.terrain*100)}</td><td>Share of valid land with slope ≤ 3 %: ${s.flat_pct[0]} % = 0, ${s.flat_pct[1]} % = 1.</td></tr>
<tr><td>Grid · ${f(w.grid*100)}</td><td>Distance to the nearest 115–400 kV line or ≤161 kV substation (OpenStreetMap): ≤${s.grid_km[0]} km = 1, ≥${s.grid_km[1]} km = 0. Says nothing about spare capacity.</td></tr></table>
<h2>3 · Combination</h2>
<p><b>Strict</b> (default): weighted geometric mean, <code>100 × Π component^weight</code>. A node that is poor in one component cannot be rescued by the others, so scores spread out and few nodes reach the top. <b>Balanced</b>: plain weighted average. Weights are normalised to sum to 100 and every slider recalculates the map, ranking and panels live.</p>
<h2>Limits</h2><ul>
<li>Node location is the <b>municipality centroid</b>; the real substation can be tens of km away. Congestion belongs to the node itself, but the land does not.</li>
<li>Land cover is 1:250,000 and slope 81 m: a regional screen, not a site survey. No land ownership, price, water, soil, or interconnection capacity.</li>
<li>Price and congestion scales are relative to this node set; a high score means "good compared with other nodes".</li>
<li>OpenStreetMap grid completeness is unaudited. Data: © OpenStreetMap contributors (ODbL), INEGI, CONANP, CENACE, NASA POWER. Generated ${M.generated}.</li></ul>`}
controls();method();fit(ALL);panel();draw();window.onresize=()=>{fit(SEL?V:ALL);draw()};
