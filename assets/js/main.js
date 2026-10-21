/* ---- Edit these ---- */
const CONFIG = {
  airbnb: 'https://www.airbnb.com.vn/rooms/1769640627295243012',
  whatsapp: '',  // digits with country code, e.g. '13465550123'
  email: '',     // e.g. 'stay@example.com'
  phone: ''      // shown as text, e.g. '+1 346 555 0123'
};

try{ window.lucide && lucide.createIcons(); }catch(e){}
const $=id=>document.getElementById(id);
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
const fine=matchMedia('(hover:hover) and (pointer:fine)').matches;
const hasGsap=!!(window.gsap&&window.ScrollTrigger);

/* ---------- smooth scroll ---------- */
let lenis=null;
if(!reduce&&window.Lenis){
  try{
    lenis=new Lenis({lerp:.085,wheelMultiplier:1,smoothWheel:true});
    if(hasGsap){lenis.on('scroll',ScrollTrigger.update);gsap.ticker.add(t=>lenis.raf(t*1000));gsap.ticker.lagSmoothing(0)}
    else{const raf=t=>{lenis.raf(t);requestAnimationFrame(raf)};requestAnimationFrame(raf)}
  }catch(e){lenis=null}
}
function scrollToTarget(sel){
  const el=document.querySelector(sel);if(!el)return;
  if(lenis)lenis.scrollTo(el,{offset:sel==='#top'?0:-20,duration:1.6,easing:t=>1-Math.pow(1-t,4)});
  else el.scrollIntoView({behavior:reduce?'auto':'smooth'});
}
document.querySelectorAll('a[data-scroll]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();setMenu(false);scrollToTarget(a.getAttribute('href'))}));

/* ---------- header: solid after hero, hides on scroll down ---------- */
let lastY=0;
function onScroll(y){
  document.body.classList.toggle('scrolled',y>60);
  const down=y>lastY+4,up=y<lastY-4;
  if(y>innerHeight*.9&&down)document.body.classList.add('hide-bar');
  if(up||y<200)document.body.classList.remove('hide-bar');
  lastY=y;
  const book=$('booking').getBoundingClientRect();
  $('fab').classList.toggle('on',y>innerHeight*.8&&!(book.top<innerHeight&&book.bottom>0));
}
addEventListener('scroll',()=>onScroll(scrollY),{passive:true});
onScroll(scrollY);

/* ---------- menu ---------- */
const burger=$('burger'),menu=$('menu');
function setMenu(o){
  document.body.classList.toggle('menu-open',o);burger.setAttribute('aria-expanded',o);
  burger.setAttribute('aria-label',o?'Close menu':'Open menu');menu.setAttribute('aria-hidden',!o);
  if(lenis)o?lenis.stop():lenis.start();
}
burger.onclick=()=>setMenu(!document.body.classList.contains('menu-open'));
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('menu-open'))setMenu(false)});


/* ---------- menu: local time and today's sunrise at Surfside Beach ---------- */
function sunriseAt(lat,lon,now){
  const rad=Math.PI/180;
  const [y,m,d]=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).split('-').map(Number);
  const n=Math.round(Date.UTC(y,m-1,d,18)/864e5+2440587.5-2451545+0.0008);
  const Js=n-lon/360,M=(357.5291+0.98560028*Js)%360;
  const C=1.9148*Math.sin(M*rad)+0.02*Math.sin(2*M*rad)+0.0003*Math.sin(3*M*rad);
  const L=(M+C+282.9372)%360;
  const Jt=2451545+Js+0.0053*Math.sin(M*rad)-0.0069*Math.sin(2*L*rad);
  const dec=Math.asin(Math.sin(L*rad)*Math.sin(23.4397*rad));
  const w=Math.acos((Math.sin(-0.833*rad)-Math.sin(lat*rad)*Math.sin(dec))/(Math.cos(lat*rad)*Math.cos(dec)))/rad;
  return new Date((Jt-w/360-2440587.5)*864e5);
}
const tfmt=d=>d.toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
const CITIES=[
  {n:'Surfside',c:'Surfside',tz:'America/Chicago',home:1},{n:'Mexico City',c:'MEX',tz:'America/Mexico_City'},{n:'New York',c:'NYC',tz:'America/New_York'},
  {n:'London',c:'LON',tz:'Europe/London'},{n:'Ho Chi Minh City',c:'SGN',tz:'Asia/Ho_Chi_Minh'},{n:'Tokyo',c:'TYO',tz:'Asia/Tokyo'}];
function tzParts(now,tz){const o={};new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}).formatToParts(now).forEach(p=>o[p.type]=+p.value||p.value);return o}
const offMin=(o,now)=>Math.round((Date.UTC(o.year,o.month-1,o.day,o.hour,o.minute)-now.getTime())/6e4);
const SUN_I='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON_I='<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
const zonesEl=$('zones');
zonesEl.innerHTML=CITIES.map(C=>`<li class="zone${C.home?' home':''}"><span class="c">${C.home?'Surfside · local':C.n}</span><span class="tm"></span><span class="d"></span></li>`).join('');
const zoneEls=[...zonesEl.children];
function zonesUpdate(){
  try{
    const now=new Date(),home=tzParts(now,CITIES[0].tz),hOff=offMin(home,now),hDay=Date.UTC(home.year,home.month-1,home.day);
    CITIES.forEach((C,i)=>{
      const o=tzParts(now,C.tz),el=zoneEls[i];
      const [hm,ap]=now.toLocaleTimeString('en-US',{timeZone:C.tz,hour:'numeric',minute:'2-digit'}).split(' ');
      el.querySelector('.tm').innerHTML=`${hm}<small>${ap}</small>`;
      const day=o.hour>=6&&o.hour<19,dd=Math.round((Date.UTC(o.year,o.month-1,o.day)-hDay)/864e5),dh=(offMin(o,now)-hOff)/60;
      const when=C.home?(day?'Daytime':'Night'):((dh>0?'+':dh<0?'−':'')+(dh?Math.abs(dh)+' h':'Same time')+(dd>0?' · tomorrow':dd<0?' · yesterday':''));
      const d=el.querySelector('.d');d.className='d '+(day?'day':'night');d.innerHTML=(day?SUN_I:MOON_I)+'<span>'+when+'</span>';
      el.setAttribute('aria-label',`${C.n}: ${hm} ${ap}, ${when}`);
    });
    $('mSun').textContent=tfmt(sunriseAt(28.95,-95.29,now));
  }catch(e){}
}
zonesUpdate();setInterval(zonesUpdate,15000);
burger.addEventListener('click',zonesUpdate);

/* ---------- hero title mask rise ---------- */
const h1=$('h1');
h1.innerHTML=h1.textContent.trim().split(' ').map((w,i)=>`<span class="mask"><span style="animation-delay:${.15+i*.07}s">${w}</span></span>`).join(' ');

/* ---------- statement word fill ---------- */
const st=$('statement');
st.innerHTML=st.innerHTML.replace(/<em>(.*?)<\/em>|([^\s<]+)/g,(m,em,w)=>em?`<span class="w hl">${em}</span>`:`<span class="w">${w}</span>`);
const words=[...st.querySelectorAll('.w')];
function fillWords(p){const n=reduce?words.length:Math.round(p*words.length);words.forEach((w,i)=>w.classList.toggle('on',i<n))}

/* ---------- marquee driven by scroll velocity ---------- */
const mq=$('mq');let mx=0,vel=0,dir=1;
if(lenis)lenis.on('scroll',e=>{vel=e.velocity||0;if(Math.abs(vel)>.2)dir=vel>0?1:-1});
function mqTick(dt){
  if(reduce)return;
  const half=mq.scrollWidth/2+20;
  mx-=(0.6+Math.min(Math.abs(vel),40)*0.25)*dir*dt;
  if(mx<-half)mx+=half;if(mx>0)mx-=half;
  mq.style.transform=`translate3d(${mx}px,0,0)`;
  vel*=.92;
}

/* ---------- GSAP choreography ---------- */
if(hasGsap&&!reduce){
  gsap.registerPlugin(ScrollTrigger);
  gsap.ticker.add((t,dt)=>mqTick(dt/16.67));

  /* hero shrinks into a rounded card, content drifts up */
  gsap.to('#heroMedia',{clipPath:'inset(3% 2.5% 0% 2.5% round 28px)',ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
  gsap.to('#heroImg',{yPercent:12,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
  gsap.to('#heroIn',{yPercent:-18,opacity:.25,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});

  /* page tone shifts per section */
  document.querySelectorAll('[data-tone]').forEach(sec=>{
    ScrollTrigger.create({trigger:sec,start:'top 55%',end:'bottom 55%',onToggle:s=>{if(s.isActive)document.documentElement.style.setProperty('--tone',sec.dataset.tone)}});
  });

  /* statement fill */
  ScrollTrigger.create({trigger:st,start:'top 85%',end:'bottom 40%',scrub:true,onUpdate:s=>fillWords(s.progress)});

  /* headings: words lift into place (visible throughout) */
  document.querySelectorAll('[data-split]').forEach(h=>{
    h.innerHTML=h.textContent.trim().split(' ').map(w=>`<span class="w">${w}</span>`).join(' ');
    gsap.from(h.querySelectorAll('.w'),{y:'0.5em',opacity:.25,duration:.9,ease:'power3.out',stagger:.05,scrollTrigger:{trigger:h,start:'top 88%',once:true}});
  });

  /* clip reveals for large images */
  document.querySelectorAll('[data-clip]').forEach(el=>{
    gsap.fromTo(el,{clipPath:'inset(10% 8% 10% 8% round 28px)'},{clipPath:'inset(0% 0% 0% 0% round 18px)',ease:'none',scrollTrigger:{trigger:el,start:'top 95%',end:'top 35%',scrub:true}});
  });

  /* inner parallax */
  document.querySelectorAll('[data-par]').forEach(img=>{
    const a=+img.dataset.par;
    gsap.fromTo(img,{yPercent:-a/2},{yPercent:a/2,ease:'none',scrollTrigger:{trigger:img.parentElement,start:'top bottom',end:'bottom top',scrub:true}});
  });

  /* staggered grids */
  document.querySelectorAll('[data-stagger]').forEach(g=>{
    gsap.from(g.children,{y:40,opacity:.3,duration:.9,ease:'power3.out',stagger:.06,scrollTrigger:{trigger:g,start:'top 88%',once:true}});
  });

  /* stacking cards: earlier cards sink back as the next one arrives */
  const cards=gsap.utils.toArray('.scard');
  cards.forEach((c,i)=>{
    if(i===cards.length-1)return;
    const next=cards[i+1];
    gsap.to(c,{scale:.92,ease:'none',scrollTrigger:{trigger:next,start:'top bottom',end:'top 120px',scrub:true}});
    gsap.to(c.querySelector('.shade'),{opacity:.45,ease:'none',scrollTrigger:{trigger:next,start:'top bottom',end:'top 120px',scrub:true}});
  });

  /* pinned horizontal rooms (desktop) */
  const mm=gsap.matchMedia();
  const hs=$('hs'),rooms=hs.children.length;
  mm.add('(min-width: 761px)',()=>{
    const dist=()=>Math.max(0,hs.scrollWidth-hs.clientWidth);
    const tw=gsap.to(hs,{x:()=>-dist(),ease:'none',scrollTrigger:{trigger:'#pin',start:'top top',end:()=>'+='+dist(),pin:true,scrub:1,invalidateOnRefresh:true,anticipatePin:1,
      onUpdate:s=>{gsap.set('#pbar',{scaleX:s.progress});$('pcount').textContent=String(Math.min(rooms,Math.floor(s.progress*(rooms-.01))+1)).padStart(2,'0')+' / '+String(rooms).padStart(2,'0')}}});
    hs.querySelectorAll('.room img').forEach(img=>gsap.fromTo(img,{xPercent:-6},{xPercent:6,ease:'none',scrollTrigger:{trigger:img,containerAnimation:tw,start:'left right',end:'right left',scrub:true}}));
    return ()=>gsap.set(hs,{x:0});
  });
  mm.add('(max-width: 760px)',()=>{
    const upd=()=>{const p=hs.scrollLeft/Math.max(1,hs.scrollWidth-hs.clientWidth);gsap.set('#pbar',{scaleX:p});$('pcount').textContent=String(Math.round(p*(rooms-1))+1).padStart(2,'0')+' / '+String(rooms).padStart(2,'0')};
    hs.addEventListener('scroll',upd,{passive:true});upd();
    return ()=>hs.removeEventListener('scroll',upd);
  });

  /* booking image opens from a card to full bleed */
  gsap.fromTo('#bookMedia',{clipPath:'inset(6% 5% 6% 5% round 32px)'},{clipPath:'inset(0% 0% 0% 0% round 0px)',ease:'none',scrollTrigger:{trigger:'#booking',start:'top 90%',end:'top 15%',scrub:true}});
  gsap.from('#bcard',{y:80,opacity:.4,ease:'power3.out',duration:1,scrollTrigger:{trigger:'#bcard',start:'top 92%',once:true}});

  /* footer content rises as the curtain lifts */
  gsap.from('.foot .in',{y:60,opacity:.4,ease:'none',scrollTrigger:{trigger:'.foot',start:'top bottom',end:'bottom bottom',scrub:true}});

  addEventListener('load',()=>ScrollTrigger.refresh());
}else{
  fillWords(1);
  const tick=()=>{mqTick(1);requestAnimationFrame(tick)};if(!reduce)requestAnimationFrame(tick);
}

/* ---------- custom cursor + magnetic buttons ---------- */
if(fine&&!reduce){
  const cur=$('cursor');let cx=innerWidth/2,cy=innerHeight/2,tx=cx,ty=cy;
  addEventListener('pointermove',e=>{tx=e.clientX;ty=e.clientY});
  (function loop(){cx+=(tx-cx)*.18;cy+=(ty-cy)*.18;cur.style.left=cx+'px';cur.style.top=cy+'px';requestAnimationFrame(loop)})();
  document.querySelectorAll('[data-cursor]').forEach(el=>{
    el.addEventListener('pointerenter',()=>{cur.textContent=el.dataset.cursor;cur.classList.add('on')});
    el.addEventListener('pointerleave',()=>cur.classList.remove('on'));
  });
  document.querySelectorAll('.btn').forEach(b=>{
    b.addEventListener('pointermove',e=>{const r=b.getBoundingClientRect();b.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.18}px,${(e.clientY-r.top-r.height/2)*.25}px)`});
    b.addEventListener('pointerleave',()=>{b.style.transform=''});
  });
}

/* ---------- FAQ accordion ---------- */
document.querySelectorAll('.qa button').forEach(b=>b.addEventListener('click',()=>{
  const qa=b.parentElement,open=!qa.classList.contains('open');
  document.querySelectorAll('.qa.open').forEach(o=>{if(o!==qa){o.classList.remove('open');o.querySelector('button').setAttribute('aria-expanded','false')}});
  qa.classList.toggle('open',open);b.setAttribute('aria-expanded',open);
  setTimeout(()=>hasGsap&&ScrollTrigger.refresh(),550);
}));

/* ---------- lightbox ---------- */
const PHOTOS=[['assets/img/deck.webp','Covered deck facing the Gulf'],['assets/img/kitchen.webp','Kitchen'],['assets/img/dining.webp','Dining and living area'],['assets/img/gulf.webp','Gulf of Mexico from the deck'],['assets/img/lounge.webp','Lounge'],['assets/img/aerial.webp','The house from above'],['assets/img/living.webp','Living room']];
const lb=$('lb'),lbimg=$('lbimg');let li=0,last;
function show(i){li=(i+PHOTOS.length)%PHOTOS.length;lbimg.classList.add('swap');setTimeout(()=>{lbimg.src=PHOTOS[li][0];lbimg.alt=PHOTOS[li][1];lbimg.classList.remove('swap')},150);$('lbc').textContent=PHOTOS[li][1]+' · '+(li+1)+' / '+PHOTOS.length}
function openLb(i,from){last=from;show(i);lb.classList.add('open');lenis&&lenis.stop();$('lbx').focus()}
function closeLb(){lb.classList.remove('open');lenis&&lenis.start();last&&last.focus()}
document.querySelectorAll('#gallery-grid button').forEach(b=>b.onclick=()=>openLb(+b.dataset.i,b));
$('viewall').onclick=e=>openLb(0,e.currentTarget);
$('lbx').onclick=closeLb;$('lbp').onclick=()=>show(li-1);$('lbn').onclick=()=>show(li+1);
lb.addEventListener('click',e=>{if(e.target===lb)closeLb()});
addEventListener('keydown',e=>{if(!lb.classList.contains('open'))return;if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')show(li-1);if(e.key==='ArrowRight')show(li+1)});


/* ---------- real map of Surfside Beach (OpenStreetMap data, drawn in SVG) ---------- */
(function(){
  const box=$('map'),svg=$('mapSvg'),layer=$('mLayer'),pop=$('mpop'),hint=$('mhint');
  const K=0.875,H=2900,NS='http://www.w3.org/2000/svg';
  const P=(x,y)=>[x*K,H-y];                         // data units (1e-5 deg) -> map units (~1.11 m)
  const HOUSE=P(2070,1580);                          // Airbnb's approximate pin, 28.9438 N 95.2913 W
  const HOME={c:P(1900,1330),w:2300*K};
  const B={x0:-300*K,x1:4300*K,y0:H-3300,y1:H+300};
  let v={cx:HOME.c[0],cy:HOME.c[1],z:0},target=null,cw=1,ch=1;
  const z0=()=>Math.max(cw/HOME.w,ch/1700);
  function el(n,a){const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e}
  function draw(txt){
    const feats=txt.trim().split('\n').map(l=>{const [c,n,e]=l.split('|');let x=0,y=0;return {c,n,pts:e.split(';').map(s=>{const [a,b]=s.split(',').map(Number);x+=a;y+=b;return P(x,y)})}});
    const pts=p=>p.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
    const g=el('g',{id:'mg'});svg.appendChild(g);
    g.appendChild(el('rect',{class:'land',x:-20000,y:-20000,width:60000,height:60000}));
    const coast=feats.find(f=>f.c==='n:coastline');
    if(coast){const a=coast.pts;g.appendChild(el('polygon',{class:'sea',points:pts([...a,[a[a.length-1][0],H+60000],[a[0][0],H+60000]])}))}
    const order=[['u:residential','resi'],['u:industrial','ind'],['n:wetland','wet'],['l:park','park'],['n:beach','sand'],['n:water','wat'],['l:marina','wat']];
    for(const [c,cls] of order)for(const f of feats)if(f.c===c)g.appendChild(el('polygon',{class:cls,points:pts(f.pts)}));
    const lines=[['w:canal','wline',14],['w:river','wline',8],['m:breakwater','jetty',4],['m:pier','jetty',2]];
    for(const [c,cls,w] of lines)for(const f of feats)if(f.c===c)g.appendChild(el('polyline',{class:cls,points:pts(f.pts),'stroke-width':w}));
    const roads=[['service',1.6],['unclassified',2.2],['residential',3.2],['tertiary',4.2],['primary',6]];
    for(const [c,w] of roads)for(const f of feats)if(f.c===c)g.appendChild(el('polyline',{class:'case',points:pts(f.pts),'stroke-width':w+2.4,'vector-effect':'non-scaling-stroke','data-w':w+2.4}));
    for(const [c,w] of roads)for(const f of feats)if(f.c===c)g.appendChild(el('polyline',{class:c==='primary'?'hw':'road',points:pts(f.pts),'stroke-width':w,'vector-effect':'non-scaling-stroke','data-w':w}));
    g.appendChild(el('circle',{class:'ring',cx:HOUSE[0],cy:HOUSE[1],r:720,'stroke-width':1.6,'vector-effect':'non-scaling-stroke'}));
    g.appendChild(el('circle',{class:'area',cx:HOUSE[0],cy:HOUSE[1],r:180,'stroke-width':1.2,'vector-effect':'non-scaling-stroke'}));
  }
  const labels=[
    {t:'Gulf of Mexico',c:'sea-l',p:P(2600,1220)},
    {t:'Surfside Beach',c:'town',p:P(1620,1820)},
    {t:'Freeport Harbor Channel',c:'water',p:P(1960,470),r:47},
    {t:'Beach Drive',c:'road',p:P(2290,1830),r:-46,min:1.3},
    {t:'Bluewater Hwy',c:'road',p:P(2980,2930),r:-45,min:.9},
    {t:'Old Brazos River',c:'water',p:P(-150,2300),min:.9},
    {t:'≈ 10-min walk',c:'ringl',p:[HOUSE[0],HOUSE[1]-720]}
  ].map(L=>{const e=document.createElement('span');e.className='lab '+L.c;e.textContent=L.t;layer.appendChild(e);return {...L,e}});
  const marks=[
    {p:HOUSE,html:'<span class="mpin"><i></i></span><span class="chip">Surfside Sunrise House<small>Approximate location</small></span>',ax:20,ay:20,
     pop:'<b>Surfside Sunrise House</b><p>Beachfront on the Gulf. Airbnb shows an approximate location; the exact address is shared after booking.</p><a href="https://www.google.com/maps/search/?api=1&query=Surfside+Beach+Texas" target="_blank" rel="noopener">Open area in Google Maps ↗</a>'},
    {p:P(1500,1150),html:'<span class="dot"></span><span class="chip">Surfside Jetty Park<small>About 10 min on foot</small></span>',ax:8,ay:8,
     pop:'<b>Surfside Jetty Park</b><p>Park and jetty at the mouth of the Freeport Harbor Channel. About a 10-minute walk from the house.</p><a href="https://www.google.com/maps/search/?api=1&query=Surfside+Jetty+Park+Texas" target="_blank" rel="noopener">Open in Google Maps ↗</a>'}
  ].map(M=>{const b=document.createElement('button');b.type='button';b.className='mk';b.innerHTML=M.html;b.setAttribute('aria-label',b.textContent);layer.appendChild(b);
    b.addEventListener('pointerdown',e=>e.stopPropagation());b.addEventListener('click',()=>openPop(M));return {...M,e:b}});
  let popM=null;
  function openPop(M){popM=M;pop.innerHTML='<button class="x" type="button" aria-label="Close">×</button>'+M.pop;pop.hidden=false;pop.querySelector('.x').onclick=()=>{pop.hidden=true;popM=null};place()}
  const scr=p=>[(p[0]-v.cx)*v.z+cw/2,(p[1]-v.cy)*v.z+ch/2];
  function clamp(){const zmin=Math.max(cw/(B.x1-B.x0),ch/(B.y1-B.y0)),zmax=z0()*7;v.z=Math.min(zmax,Math.max(zmin,v.z));
    const hw=cw/2/v.z,hh=ch/2/v.z;v.cx=Math.min(B.x1-hw,Math.max(B.x0+hw,v.cx));v.cy=Math.min(B.y1-hh,Math.max(B.y0+hh,v.cy))}
  function place(){
    const k=v.z/z0();
    labels.forEach(L=>{const [x,y]=scr(L.p);L.e.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%) rotate(${L.r||0}deg)`;L.e.classList.toggle('hide',!!L.min&&k<L.min)});
    marks.forEach(M=>{const [x,y]=scr(M.p);M.e.style.transform=`translate(${x-M.ax}px,${y-M.ay}px)`});
    if(popM&&!pop.hidden){const [x,y]=scr(popM.p);const w=pop.offsetWidth,h=pop.offsetHeight;pop.style.transform=`translate(${Math.min(cw-w-14,Math.max(14,x-w/2))}px,${Math.max(14,y-h-34)}px)`}
  }
  function render(){
    clamp();svg.setAttribute('viewBox',`${v.cx-cw/2/v.z} ${v.cy-ch/2/v.z} ${cw/v.z} ${ch/v.z}`);
    const s=Math.min(2.2,Math.max(.75,Math.sqrt(v.z/z0())));
    if(render.s!==s){render.s=s;svg.querySelectorAll('[data-w]').forEach(p=>p.setAttribute('stroke-width',(+p.dataset.w*s).toFixed(2)))}
    const mpp=1.112/v.z,nice=[50,100,200,250,500,1000,2000,5000];let m=nice[0];for(const n of nice)if(n/mpp<=120)m=n;
    $('sbar').style.width=(m/mpp).toFixed(0)+'px';$('stext').textContent=m>=1000?(m/1000)+' km':m+' m';
    place();
  }
  function animTo(t){target=t;if(reduce){Object.assign(v,t);target=null;render();return}
    if(!animTo.run){animTo.run=true;(function step(){if(!target){animTo.run=false;return}
      v.cx+=(target.cx-v.cx)*.16;v.cy+=(target.cy-v.cy)*.16;v.z*=Math.pow(target.z/v.z,.16);render();
      if(Math.abs(target.cx-v.cx)<.5&&Math.abs(target.cy-v.cy)<.5&&Math.abs(target.z/v.z-1)<.002){Object.assign(v,target);target=null;render();animTo.run=false;return}
      requestAnimationFrame(step)})()}}
  function zoomAt(f,sx,sy){const ax=v.cx+(sx-cw/2)/v.z,ay=v.cy+(sy-ch/2)/v.z;const nz=v.z*f;return {z:nz,cx:ax-(sx-cw/2)/nz,cy:ay-(sy-ch/2)/nz}}
  function home(){return {cx:HOME.c[0],cy:HOME.c[1],z:z0()}}
  function resize(){const r=box.getBoundingClientRect();const k=v.z?v.z/z0():1;cw=r.width||1;ch=r.height||1;v.z=k*z0();render()}
  const quiet=()=>hint.classList.add('off');
  $('zin').onclick=()=>{quiet();animTo(zoomAt(1.6,cw/2,ch/2))};
  $('zout').onclick=()=>{quiet();animTo(zoomAt(1/1.6,cw/2,ch/2))};
  $('zreset').onclick=()=>animTo(home());
  box.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();e.stopPropagation();quiet();target=null;const r=box.getBoundingClientRect();Object.assign(v,zoomAt(Math.exp(-e.deltaY*.0025),e.clientX-r.left,e.clientY-r.top));render()},{passive:false});
  let drag=null;
  box.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&touches>1)return;if(e.target.closest('.mctl,.mpop,.mattr'))return;drag={x:e.clientX,y:e.clientY,cx:v.cx,cy:v.cy,id:e.pointerId};target=null;box.setPointerCapture(e.pointerId);box.classList.add('drag')});
  box.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;v.cx=drag.cx-(e.clientX-drag.x)/v.z;v.cy=drag.cy-(e.clientY-drag.y)/v.z;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4)quiet();render()});
  const end=()=>{drag=null;box.classList.remove('drag')};box.addEventListener('pointerup',end);box.addEventListener('pointercancel',end);
  let touches=0,pinch=null;
  box.addEventListener('touchstart',e=>{touches=e.touches.length;if(touches===2){drag=null;const [a,b]=e.touches,r=box.getBoundingClientRect();pinch={d:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),z:v.z,mx:(a.clientX+b.clientX)/2-r.left,my:(a.clientY+b.clientY)/2-r.top,cx:v.cx,cy:v.cy};quiet()}},{passive:true});
  box.addEventListener('touchmove',e=>{if(e.touches.length!==2||!pinch)return;e.preventDefault();const [a,b]=e.touches,r=box.getBoundingClientRect();const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);const mx=(a.clientX+b.clientX)/2-r.left,my=(a.clientY+b.clientY)/2-r.top;
    Object.assign(v,{cx:pinch.cx,cy:pinch.cy,z:pinch.z});Object.assign(v,zoomAt(d/pinch.d,pinch.mx,pinch.my));v.cx-=(mx-pinch.mx)/v.z;v.cy-=(my-pinch.my)/v.z;render()},{passive:false});
  box.addEventListener('touchend',e=>{touches=e.touches.length;if(touches<2)pinch=null},{passive:true});
  if(!fine)hint.textContent='Drag sideways to explore · Pinch to zoom';
  fetch('assets/data/map-data.txt').then(r=>{if(!r.ok)throw 0;return r.text()}).then(t=>{draw(t);resize();new ResizeObserver(resize).observe(box)})
    .catch(()=>{box.insertAdjacentHTML('beforeend','<div class="mfail">The map could not load. Use “Open in Google Maps” below.</div>')});
})();

/* ---------- footer contacts ---------- */
const fc=$('fcontact-col'),esc=s=>s.replace(/[<>&"]/g,'');
if(CONFIG.email)fc.insertAdjacentHTML('beforeend',`<span>${esc(CONFIG.email)}</span>`);
if(CONFIG.phone)fc.insertAdjacentHTML('beforeend',`<span>${esc(CONFIG.phone)}</span>`);
if(CONFIG.whatsapp)fc.insertAdjacentHTML('beforeend',`<a href="https://wa.me/${CONFIG.whatsapp.replace(/\D/g,'')}" target="_blank" rel="noopener">WhatsApp</a>`);

/* ---------- booking request ---------- */
const d=new Date(),today=new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
$('fin').min=today;$('fout').min=today;
let guests=2;
function setG(n){guests=Math.min(8,Math.max(1,n));$('gv').textContent=guests+(guests>1?' guests':' guest');$('gm').disabled=guests<=1;$('gp').disabled=guests>=8}
$('gm').onclick=()=>setG(guests-1);$('gp').onclick=()=>setG(guests+1);setG(2);
const fmt=s=>new Date(s+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
function nightsTxt(){const a=$('fin').value,b=$('fout').value;if(a&&b&&b>a){const n=Math.round((new Date(b)-new Date(a))/864e5);$('nights').textContent=`${n} night${n>1?'s':''} · ${fmt(a)} to ${fmt(b)}`}else $('nights').textContent=''}
$('fin').addEventListener('change',()=>{const i=$('fin').value;$('fout').min=i||today;if($('fout').value&&$('fout').value<=i)$('fout').value='';nightsTxt()});
$('fout').addEventListener('change',nightsTxt);
$('form').addEventListener('submit',e=>{
  e.preventDefault();
  const a=$('fin').value,b=$('fout').value,n=$('fname').value.trim(),c=$('fcontact').value.trim(),note=$('fnote').value.trim(),err=$('err');
  err.textContent='';
  if(!a||!b)return err.textContent='Choose your check-in and check-out dates.';
  if(b<=a)return err.textContent='Check-out must be after check-in.';
  if(!n)return err.textContent='Add your name so we know who to reply to.';
  if(!c)return err.textContent='Add an email or phone number so we can reach you.';
  const nights=Math.round((new Date(b)-new Date(a))/864e5);
  const text=`Hello, I would like to stay at Surfside Sunrise House.\n\nDates: ${fmt(a)} to ${fmt(b)} (${nights} night${nights>1?'s':''})\nGuests: ${guests}\nName: ${n}\nContact: ${c}${note?'\nMessage: '+note:''}`;
  $('msg').textContent=text;
  const send=$('send');send.querySelectorAll('a').forEach(x=>x.remove());
  const add=(label,href)=>{const l=document.createElement('a');l.className='btn btn-navy';l.href=href;l.target='_blank';l.rel='noopener';l.textContent=label;send.appendChild(l)};
  if(CONFIG.whatsapp)add('Send on WhatsApp','https://wa.me/'+CONFIG.whatsapp.replace(/\D/g,'')+'?text='+encodeURIComponent(text));
  if(CONFIG.email)add('Send by email','mailto:'+CONFIG.email+'?subject='+encodeURIComponent('Stay request '+a)+'&body='+encodeURIComponent(text));
  add('Message on Airbnb',CONFIG.airbnb);
  $('result').hidden=false;
  hasGsap&&ScrollTrigger.refresh();
});
$('copy').onclick=async()=>{
  const b=$('copy');
  try{await navigator.clipboard.writeText($('msg').textContent);b.textContent='Copied'}
  catch(_){const r=document.createRange();r.selectNodeContents($('msg'));const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Selected, press Ctrl+C'}
  setTimeout(()=>b.textContent='Copy message',2200);
};
