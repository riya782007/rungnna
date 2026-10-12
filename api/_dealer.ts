import { page, esc, type Shop } from "./_pages.js";

/* ===========================================================================
   The dealer portal (/dealer) — retailers register with their mobile + PIN,
   wait for the shop's approval, then browse published designs at trade rates
   and place orders. Modelled on the reference wholesale dashboard: search,
   category chips, packet steppers, a sticky cart with the minimum-order meter,
   and order history.

   Everything a dealer does is a call to the dealer_* database functions with
   the public key and the dealer's own session token (see the migration). The
   page itself holds no secrets and never sets prices: the server prices orders.
=========================================================================== */

export function renderDealer(shop: Shop, base: string, cfg: { url: string; key: string }): string {
  const body = `<div id="dp" class="dp"><p class="mut">Loading…</p></div><noscript><p>Please turn on JavaScript to use the dealer portal.</p></noscript>`;
  return page({ title: `Dealer login · ${shop.name || "Rungnna Jewellery & Co"}`, description: "Wholesale ordering for registered retailers.", canonical: `${base}/dealer`, robots: "noindex, nofollow",
    extra: `<style>${DCSS}</style>` }, shop, body, base, { nav: "trade", script: script(cfg, shop) });
}

const DCSS = `.dp{max-width:1180px;margin:0 auto}.auth{max-width:420px;margin:24px auto;background:#fff;border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 18px 50px -24px rgba(36,27,46,.35)}
.auth header{background:linear-gradient(140deg,var(--em-d),var(--em));color:#fff;padding:22px 24px}.auth header h1{color:var(--gold-l);font-size:30px;margin:0}.auth header p{margin:4px 0 0;color:#CFE3DD;font-size:14px}
.auth form{padding:20px 24px;display:grid;gap:12px}.auth label{display:grid;gap:4px;font-size:13px;color:var(--mut)}
.in{width:100%;height:46px;border:1px solid var(--line);border-radius:12px;padding:0 14px;font:inherit;background:#fff;color:var(--ink)}.in:focus{outline:none;border-color:var(--em);box-shadow:0 0 0 3px var(--mist)}
.tabs{display:flex;gap:4px;background:var(--gold-l);border-radius:999px;padding:4px;margin:0 24px}.tabs button{flex:1;border:0;background:none;border-radius:999px;height:36px;font:600 14px inherit;color:var(--mut);cursor:pointer}.tabs button[aria-pressed=true]{background:#fff;color:var(--em-d);box-shadow:0 1px 4px rgba(0,0,0,.08)}
.msg{border-radius:12px;padding:10px 14px;font-size:14px;background:var(--mist);color:var(--em-d)}.msg.bad{background:#F8E8ED;color:#8A2F48}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:4px 0 16px}.bar .in{flex:1;min-width:200px}
.hello{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}.hello h1{margin:0}.link{background:none;border:0;color:var(--em);font:600 14px inherit;cursor:pointer;text-decoration:underline}
.stepper{display:flex;align-items:center;gap:6px}.stepper button{width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:#fff;font-size:18px;cursor:pointer;color:var(--em-d)}.stepper b{min-width:28px;text-align:center}
.card.on{border-color:var(--em);box-shadow:0 0 0 2px var(--mist)}.rate{font-weight:700;color:var(--em-d)}.mrp{font-size:12px;color:var(--mut);text-decoration:line-through}.margin{font-size:12px;color:var(--gold-d);font-weight:600}
.cart{position:sticky;bottom:12px;margin-top:22px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:14px 16px;box-shadow:0 16px 40px -16px rgba(36,27,46,.4);display:grid;gap:10px}
.meter{height:8px;border-radius:99px;background:var(--gold-l);overflow:hidden}.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--em))}
.cart .row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.orders{display:grid;gap:8px}.orders div{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 14px;display:flex;justify-content:space-between;gap:8px;font-size:14px}
.pill{display:inline-block;border-radius:99px;padding:1px 10px;font-size:12px;font-weight:600;background:var(--gold-l);color:var(--gold-d)}.pill.billed{background:var(--mist);color:var(--em-d)}.pill.cancelled{background:#F8E8ED;color:#8A2F48}`;

function script(cfg: { url: string; key: string }, shop: Shop): string {
  // the shop's WhatsApp for help links; everything else comes from the database functions
  const wa = String(shop.whatsapp || shop.phone || "").replace(/\D/g, "");
  return `(()=>{"use strict";
const API=${JSON.stringify(cfg.url)}+"/rest/v1/rpc/",KEY=${JSON.stringify(cfg.key)},WA=${JSON.stringify(wa.length === 10 ? "91" + wa : wa)};
const $=s=>document.querySelector(s),root=$("#dp"),T="rj_dealer",C="rj_dealer_cart";
const e=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inr=p=>"₹"+(Math.round(p)/100).toLocaleString("en-IN",{maximumFractionDigits:2});
const get=k=>{try{return localStorage.getItem(k)}catch{return null}},set=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
async function rpc(fn,args){const r=await fetch(API+fn,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(args)});
 const j=await r.json().catch(()=>null);if(!r.ok){const m=(j&&(j.message||j.hint))||"Something went wrong — try again";if(/log in again|not approved/i.test(m)){set(T,null);}throw new Error(m)}return j}
let state={mode:"login",items:[],info:null,q:"",cat:"",cart:{},busy:false,msg:"",bad:false};
try{state.cart=JSON.parse(get(C)||"{}")||{}}catch{}
const save=()=>set(C,JSON.stringify(state.cart));
function msg(t,bad){state.msg=t;state.bad=!!bad;draw()}
async function boot(){const t=get(T);if(!t){draw();return}
 try{const[info,items]=await Promise.all([rpc("dealer_portal_info",{p_token:t}),rpc("dealer_catalogue",{p_token:t})]);state.info=info;state.items=items||[];state.mode="shop";
  for(const id of Object.keys(state.cart))if(!state.items.some(p=>p.id===id))delete state.cart[id];save()}
 catch(x){state.mode="login";state.msg=x.message;state.bad=true}draw()}
function auth(){const reg=state.mode==="register";return '<div class="auth"><header><h1>'+(reg?"Register":"Dealer login")+'</h1><p>Wholesale orders at trade rates — for registered retailers.</p></header>'+
 '<div style="padding-top:16px" class="tabs"><button data-m="login" aria-pressed="'+!reg+'">Log in</button><button data-m="register" aria-pressed="'+reg+'">New dealer</button></div>'+
 '<form id="af">'+(state.msg?'<div class="msg'+(state.bad?" bad":"")+'">'+e(state.msg)+'</div>':"")+
 '<label>Mobile number<input class="in" name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile"></label>'+
 (reg?'<label>Your name<input class="in" name="name" required autocomplete="name"></label><label>Shop name<input class="in" name="shop" autocomplete="organization"></label><label>City<input class="in" name="city"></label><label>GSTIN (optional)<input class="in" name="gstin" maxlength="15" style="text-transform:uppercase"></label>':"")+
 '<label>'+(reg?"Choose a 4–6 digit PIN":"PIN")+'<input class="in" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="'+(reg?"new-password":"current-password")+'"></label>'+
 '<button class="btn" '+(state.busy?"disabled":"")+'>'+(state.busy?"Please wait…":reg?"Register":"Log in")+'</button>'+
 (WA?'<a class="mut" style="font-size:13px" href="https://wa.me/'+WA+'?text='+encodeURIComponent("Hello, I need help with the dealer portal")+'">Forgot PIN? Message the shop</a>':"")+'</form></div>'}
function shopView(){const i=state.info||{},q=state.q.toLowerCase().trim(),cats=[...new Set(state.items.map(p=>p.category).filter(Boolean))].sort();
 const list=state.items.filter(p=>(!state.cat||p.category===state.cat)&&(!q||[p.title,p.code,p.style,p.color,p.item,p.category].join(" ").toLowerCase().includes(q)));
 const lines=Object.entries(state.cart).map(([id,n])=>({p:state.items.find(x=>x.id===id),n})).filter(x=>x.p&&x.n>0);
 const total=lines.reduce((a,x)=>a+x.p.rate*x.n*(x.p.pack||1),0),pcs=lines.reduce((a,x)=>a+x.n*(x.p.pack||1),0),min=Number(i.min_order)||0,pct=min?Math.min(100,Math.round(total*100/min)):100;
 const card=p=>{const n=state.cart[p.id]||0,pk=p.pack||1,m=p.mrp&&p.mrp>p.rate?Math.round((p.mrp-p.rate)*100/p.mrp):0;
  return '<div class="card'+(n?" on":"")+'">'+(p.image_url?'<img loading="lazy" src="'+e(p.image_url)+'" alt="'+e(p.title)+'">':'<div class="noimg">R</div>')+
  '<h3>'+e(p.title)+'</h3><div class="tmeta"><span class="code">'+e(p.code)+'</span><span>'+e([p.color,p.size].filter(Boolean).join(" · "))+'</span></div>'+
  '<div class="meta"><span><span class="rate">'+inr(p.rate)+'</span> <small class="mut">/'+e((p.type||"pc").toLowerCase())+'</small>'+(p.mrp?' <span class="mrp">'+inr(p.mrp)+'</span>':"")+'</span>'+(m?'<span class="margin">'+m+'% margin</span>':"")+'</div>'+
  '<div class="qty"><span class="mut">'+(pk>1?"Packet of "+pk:"Pieces")+(p.available>0?"":" · <span class=warn>on order</span>")+'</span><span class="stepper"><button data-d="-1" data-id="'+p.id+'" aria-label="less">−</button><b>'+n+'</b><button data-d="1" data-id="'+p.id+'" aria-label="more">+</button></span></div></div>'};
 return '<div class="hello"><div><p class="mut" style="margin:0">Namaste'+(i.name?", "+e(i.name):"")+'</p><h1>Wholesale catalogue</h1></div><button class="link" id="out">Log out</button></div>'+
 '<p class="mut">Trade rates for registered dealers'+(min?" · minimum order "+inr(min):"")+'. Orders are confirmed by the shop on WhatsApp.</p>'+
 (state.msg?'<div class="msg'+(state.bad?" bad":"")+'" style="margin-bottom:12px">'+e(state.msg)+'</div>':"")+
 '<div class="bar"><input class="in" id="q" placeholder="Search design, code, colour…" value="'+e(state.q)+'"></div>'+
 (cats.length?'<div class="chips"><a href="#" data-c=""'+(!state.cat?' aria-current="true"':"")+'>All</a>'+cats.map(c=>'<a href="#" data-c="'+e(c)+'"'+(state.cat===c?' aria-current="true"':"")+'>'+e(c)+'</a>').join("")+'</div>':"")+
 (list.length?'<div class="grid">'+list.map(card).join("")+'</div>':'<p class="mut">No designs match.</p>')+
 (lines.length?'<div class="cart"><div class="row"><b>'+lines.length+' design'+(lines.length>1?"s":"")+' · '+pcs+' pcs</b><b class="rate" style="font-size:20px">'+inr(total)+'</b></div>'+
  (min?'<div class="meter"><i style="width:'+pct+'%"></i></div><div class="mut" style="font-size:13px">'+(total>=min?"Minimum order reached":"Add "+inr(min-total)+" more to place the order")+'</div>':"")+
  '<input class="in" id="note" placeholder="Note for the shop (transport, marka…)" maxlength="300">'+
  '<div class="row"><button class="link" id="clear">Empty cart</button><button class="btn" id="place" '+(state.busy||total<min?"disabled":"")+'>'+(state.busy?"Placing…":"Place order")+'</button></div></div>':"")+
 ((i.orders||[]).length?'<section><h2>Your orders</h2><div class="orders">'+i.orders.map(o=>'<div><span><b>'+e(o.no)+'</b> <span class="pill '+e(o.status)+'">'+e(o.status==="new"?"received":o.status)+'</span><br><span class="mut">'+new Date(o.at).toLocaleDateString("en-IN")+" · "+o.total_qty+" pcs"+(o.bill_no?" · bill "+e(o.bill_no):"")+'</span></span><b>'+inr(o.total)+'</b></div>').join("")+'</div></section>':"")}
function draw(){root.innerHTML=state.mode==="shop"?shopView():auth();bind()}
function bind(){
 root.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{state.mode=b.dataset.m;state.msg="";draw()});
 const f=$("#af");if(f)f.onsubmit=async ev=>{ev.preventDefault();const d=Object.fromEntries(new FormData(f));state.busy=true;draw();
  try{if(state.mode==="register"){await rpc("dealer_register",{p_phone:d.phone,p_name:d.name,p_shop:d.shop||"",p_city:d.city||"",p_gstin:d.gstin||"",p_pin:d.pin});state.busy=false;state.mode="login";msg("Registered! The shop will approve your account — you'll get a WhatsApp, then log in here.");return}
   const r=await rpc("dealer_login",{p_phone:d.phone,p_pin:d.pin});state.busy=false;if(r&&r.error){msg(r.error,true);return}set(T,r.token);state.msg="";await boot()}
  catch(x){state.busy=false;msg(x.message,true)}};
 const out=$("#out");if(out)out.onclick=async()=>{const t=get(T);set(T,null);try{await rpc("dealer_logout",{p_token:t})}catch{}state.mode="login";state.info=null;draw()};
 const q=$("#q");if(q)q.oninput=()=>{state.q=q.value;const pos=q.selectionStart;draw();const n=$("#q");n.focus();n.setSelectionRange(pos,pos)};
 root.querySelectorAll("[data-c]").forEach(a=>a.onclick=ev=>{ev.preventDefault();state.cat=a.dataset.c;draw()});
 root.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{const id=b.dataset.id,n=Math.max(0,Math.min(999,(state.cart[id]||0)+Number(b.dataset.d)));if(n)state.cart[id]=n;else delete state.cart[id];save();state.msg="";draw()});
 const c=$("#clear");if(c)c.onclick=()=>{state.cart={};save();draw()};
 const p=$("#place");if(p)p.onclick=async()=>{const items=Object.entries(state.cart).map(([id,n])=>{const it=state.items.find(x=>x.id===id);return{product_id:id,qty:n*((it&&it.pack)||1)}});
  const note=($("#note")||{}).value||"";state.busy=true;draw();
  try{const r=await rpc("dealer_place_order",{p_token:get(T),p_items:items,p_note:note});state.cart={};save();state.busy=false;state.msg="Order "+r.no+" placed · "+r.total_qty+" pcs · "+inr(r.total)+". The shop will confirm on WhatsApp.";state.bad=false;await boot();window.scrollTo({top:0,behavior:"smooth"})}
  catch(x){state.busy=false;msg(x.message,true)}};
}
boot();})();`;
}

export { esc };
