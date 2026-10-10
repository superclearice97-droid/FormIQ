/* FormIQ main script: workout tracking, tabs, consent and app wiring. */
import "./secure.js?v=18";
import { PoseLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";
import { initFood } from "./food.js?v=18";
import { initAI } from "./ai.js?v=18";
import { initActivity } from "./activity.js?v=18";
import { initRide } from "./ride.js?v=18";

const $ = id => document.getElementById(id);
const video=$("video"), canvas=$("canvas"), ctx=canvas.getContext("2d");

/* ---------- landmark helpers ---------- */
const L={ls:11,rs:12,le:13,re:14,lw:15,rw:16,lh:23,rh:24,lk:25,rk:26,la:27,ra:28};
const angle=(a,b,c)=>{const ab=Math.atan2(a.y-b.y,a.x-b.x),cb=Math.atan2(c.y-b.y,c.x-b.x);let d=Math.abs((ab-cb)*180/Math.PI);return d>180?360-d:d;};
const VIS=0.35;
const vis=(lm,ids)=>ids.every(i=>(lm[i].visibility??1)>VIS);
/* 3D joint angle from MediaPipe world landmarks (metres, hip-centred) so camera angle distorts less */
const angle3=(a,b,c)=>{const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[c.x-b.x,c.y-b.y,c.z-b.z];
  const d=u[0]*v[0]+u[1]*v[1]+u[2]*v[2],m=Math.hypot(...u)*Math.hypot(...v)||1;return Math.acos(Math.max(-1,Math.min(1,d/m)))*180/Math.PI;};
let W=null, IMG=null;
const A=(s,a,b,c)=>{const i=L[s+a],j=L[s+b],k=L[s+c];return W?angle3(W[i],W[j],W[k]):angle(IMG[i],IMG[j],IMG[k]);};
/* One Euro filter: removes jitter when still, stays responsive when moving fast */
class OneEuro{constructor(mc=1.2,beta=0.03,dc=1){this.mc=mc;this.beta=beta;this.dc=dc;this.x=null;this.dx=0;this.t=0;}
  a(c,dt){const r=2*Math.PI*c*dt;return r/(r+1);}
  f(x,t){if(this.x==null){this.x=x;this.t=t;return x;}const dt=Math.max(1e-3,(t-this.t)/1000);this.t=t;
    const dx=(x-this.x)/dt;this.dx+=this.a(this.dc,dt)*(dx-this.dx);const c=this.mc+this.beta*Math.abs(this.dx);this.x+=this.a(c,dt)*(x-this.x);return this.x;}}
let filters={};
function smoothLm(key,lm,t,mc,beta){const F=filters[key]||(filters[key]=lm.map(()=>({x:new OneEuro(mc,beta),y:new OneEuro(mc,beta),z:new OneEuro(mc,beta)})));
  return lm.map((p,i)=>({x:F[i].x.f(p.x,t),y:F[i].y.f(p.y,t),z:F[i].z.f(p.z,t),visibility:p.visibility}));}
const side=(lm)=>{const l=[11,13,15,23,25,27].reduce((s,i)=>s+(lm[i].visibility??0),0),r=[12,14,16,24,26,28].reduce((s,i)=>s+(lm[i].visibility??0),0);return l>=r?"l":"r";};
const P=(lm,s,n)=>lm[L[s+n]];

/* ---------- exercise definitions ----------
   metric(lm) -> {angle, ok, extra}. start: which end of the range a rep starts from.
   lo/hi are hysteresis thresholds; target is the ideal extreme for full range. */
const EX={
  squat:{name:"Squat",hint:"side view",start:"high",lo:105,hi:155,target:90,worst:125,
    need:s=>[s+"h",s+"k",s+"a",s+"s"],
    metric(lm,s){const h=P(lm,s,"h"),sh=P(lm,s,"s");
      const lean=Math.abs(Math.atan2(sh.x-h.x,h.y-sh.y)*180/Math.PI);
      return {angle:A(s,"h","k","a"),lean};},
    faults(f){const out=[];if(f.maxLean>50)out.push("Chest up, too much forward lean");return out;},
    track(f,m,phase){if(phase==="bottom")f.maxLean=Math.max(f.maxLean||0,m.lean);}},
  pushup:{name:"Push-up",hint:"side view",start:"high",lo:95,hi:155,target:80,worst:115,
    need:s=>[s+"s",s+"e",s+"w",s+"h",s+"a"],
    metric(lm,s){return {angle:A(s,"s","e","w"),line:A(s,"s","h","a")};},
    faults(f){const o=[];if(f.minLine<155)o.push("Keep hips in line with shoulders and ankles");return o;},
    track(f,m){f.minLine=Math.min(f.minLine??180,m.line);}},
  curl:{name:"Bicep curl",hint:"face camera",fuse:true,start:"high",lo:60,hi:145,target:40,worst:80,
    need:s=>[s+"s",s+"e",s+"w",s+"h"],
    metric(lm,s){const sh=P(lm,s,"s"),e=P(lm,s,"e"),h=P(lm,s,"h");const torso=Math.hypot(sh.x-h.x,sh.y-h.y)||1;
      return {angle:A(s,"s","e","w"),drift:Math.abs(e.x-sh.x)/torso};},
    faults(f){const o=[];if(f.maxDrift>0.35)o.push("Pin elbows to your sides");return o;},
    track(f,m){f.maxDrift=Math.max(f.maxDrift||0,m.drift);}},
  press:{name:"Overhead press",hint:"face camera",fuse:true,start:"low",lo:95,hi:155,target:170,worst:145,
    need:s=>[s+"s",s+"e",s+"w",s+"h"],
    metric(lm,s){return {angle:A(s,"s","e","w")};},
    faults(){return [];},
    track(){}},
};

/* ---------- state ---------- */
let fps=0,fpsN=0,fpsT=performance.now();
let landmarker=null, stream=null, facing="user", running=false, voice=true, lastTs=-1;
let exKey="squat";
let rep=newRepState(), set=newSet(), sets=[], restTimer=null, smooth=null, lastRepAt=0;
function newRepState(){return {phase:"start",minAngle:999,maxAngle:0,startedAt:0,f:{}};}
function newSet(){return {ex:exKey,reps:[],started:Date.now()};}

/* ---------- UI: exercise picker ---------- */
function renderEx(){
  $("exList").innerHTML=Object.entries(EX).map(([k,e])=>`<button type="button" data-k="${k}" aria-pressed="${k===exKey}">${e.name}<small>${e.hint}</small></button>`).join("");
  $("exList").querySelectorAll("button").forEach(b=>b.onclick=()=>{if(set.reps.length)finishSet();exKey=b.dataset.k;set=newSet();rep=newRepState();smooth=null;curSide=null;renderEx();renderLive();});
}

/* ---------- scoring ---------- */
function scoreRep(def,r){
  const ext= def.start==="high"? r.minAngle : r.maxAngle;   // the extreme the movement should reach
  let rom = def.start==="high" ? (def.worst-ext)/(def.worst-def.target) : (ext-def.worst)/(def.target-def.worst);
  rom=Math.max(0,Math.min(1,rom));
  const faults=def.faults({...r.f,maxAngle:r.maxAngle,minAngle:r.minAngle});
  const dur=(performance.now()-r.startedAt)/1000;
  if(dur<0.9) faults.push("Slow down, control the movement");
  if(rom<0.6) faults.unshift(def.start==="high"?"Go deeper for full range":"Press higher for full range");
  const score=Math.round(Math.max(0, rom*100 - (faults.length-(rom<0.6?1:0))*15));
  return {score,faults,dur:+dur.toFixed(1),rom:Math.round(rom*100)};
}

/* ---------- per-frame analysis ---------- */
let curSide=null, lostSince=0;
const sideScore=(lm,def,s)=>def.need(s).reduce((t,n)=>t+(lm[L[n]].visibility??0),0)/def.need(s).length;
function pickSide(lm,def){
  const l=sideScore(lm,def,"l"), r=sideScore(lm,def,"r");
  // only switch sides between reps, and only when the other side is clearly better
  if(!curSide || (rep.phase==="start" && Math.abs(l-r)>0.15)) curSide = l>=r?"l":"r";
  return {s:curSide, q:Math.max(l,r), both: l>0.6 && r>0.6};
}
function framing(lm){
  const ys=[0,11,12,23,24,27,28].map(i=>lm[i]).filter(p=>(p.visibility??0)>VIS).map(p=>p.y);
  if(ys.length<3) return null;
  const top=Math.min(...ys), bot=Math.max(...ys);
  if(top<0.02||bot>0.98) return "Step back so your whole body fits";
  if(bot-top<0.35) return "Move closer to the camera";
  return null;
}
function analyze(lm){
  const def=EX[exKey], {s,q,both}=pickSide(lm,def);
  const need=def.need(s).map(n=>L[n]);
  if(!vis(lm,need)){
    // brief dropouts (a hand passing the body, motion blur) keep the rep alive
    if(!lostSince) lostSince=performance.now();
    if(performance.now()-lostSince>600){setPhase("Not in frame");hud([[fps+" fps",""],[framing(lm)||("Turn so your "+(def.hint==="side view"?"side faces the camera":"front faces the camera")),"warn"]]);}
    return;
  }
  lostSince=0;
  let m=def.metric(lm,s);
  if(def.fuse && both){ const o=def.metric(lm,s==="l"?"r":"l"); m={...m,angle:(m.angle+o.angle)/2}; }
  smooth = smooth==null? m.angle : smooth*0.3 + m.angle*0.7;
  const a=smooth;
  const atStart = def.start==="high" ? a>=def.hi : a<=def.lo;
  const atEnd   = def.start==="high" ? a<=def.lo : a>=def.hi;

  if(rep.phase==="start"){ if(!atStart){rep.phase="moving";rep.startedAt=performance.now();rep.minAngle=a;rep.maxAngle=a;rep.f={};} }
  if(rep.phase!=="start"){
    rep.minAngle=Math.min(rep.minAngle,a); rep.maxAngle=Math.max(rep.maxAngle,a);
    if(atEnd) rep.phase="bottom";
    def.track(rep.f,m,rep.phase);
    if(rep.phase==="bottom" && atStart){ countRep(def); }
    else if(rep.phase==="moving" && atStart){ rep=newRepState(); } // partial movement, abandoned
  }
  // live range-of-motion bar
  const prog = def.start==="high" ? (def.hi-a)/(def.hi-def.target) : (a-def.lo)/(def.target-def.lo);
  $("romBar").style.width=Math.max(0,Math.min(1,prog))*100+"%";
  setPhase(rep.phase==="start"?"Ready":rep.phase==="bottom"?"Return":"Moving");
  const fr=framing(lm);
  hud([[`${Math.round(a)}°`,""],[q>0.75?"Tracking good":"Tracking weak",q>0.75?"good":"warn"],[fps+" fps",fps&&fps<12?"warn":""]].concat(fr?[[fr,"warn"]]:[]));
}

function countRep(def){
  const res=scoreRep(def,rep);
  set.reps.push(res); lastRepAt=Date.now();
  rep=newRepState();
  renderLive(res);
  speak(String(set.reps.length));
  const target=+$("targetReps").value||10;
  if(set.reps.length>=target) finishSet();
}

/* ---------- sets & rest ---------- */
function summarize(s){
  const n=s.reps.length, acc=n?Math.round(s.reps.reduce((t,r)=>t+r.score,0)/n):0;
  const counts={}; s.reps.forEach(r=>r.faults.forEach(f=>counts[f]=(counts[f]||0)+1));
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return {ex:s.ex,name:EX[s.ex].name,reps:n,acc,top:top?`${top[0]} (${top[1]}×)`:"Clean set",at:s.started};
}
function finishSet(){
  if(!set.reps.length) return;
  const sm=summarize(set); sets.push(sm);
  speak(`Set done. ${sm.reps} reps, ${sm.acc} percent.`);
  set=newSet(); rep=newRepState(); renderSets(); renderLive(); startRest();
}
function startRest(){
  clearInterval(restTimer); let t=+$("restSec").value||0; if(!t) return;
  $("restPanel").hidden=false; const draw=()=>$("restOut").textContent=`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`; draw();
  restTimer=setInterval(()=>{t--;draw();if(t<=0){clearInterval(restTimer);$("restPanel").hidden=true;speak("Rest over. Next set.");}},1000);
}
$("skipRest").onclick=()=>{clearInterval(restTimer);$("restPanel").hidden=true;};

/* ---------- rendering ---------- */
const cls=v=>v>=85?"good":v>=65?"warn":"bad";
function setPhase(t){$("phaseLabel").textContent=t;}
function hud(items){$("hud").innerHTML=items.map(([t,c])=>`<span class="chip ${c}">${t}</span>`).join("");}
function renderLive(last){
  const n=set.reps.length, target=+$("targetReps").value||10;
  $("setLabel").textContent=`${EX[exKey].name} · Set ${sets.filter(s=>s.ex===exKey).length+1}`;
  $("repsOut").textContent=n;
  const acc=n?Math.round(set.reps.reduce((t,r)=>t+r.score,0)/n):null;
  $("accOut").textContent=acc==null?"–":acc+"%";
  $("lastOut").textContent=last?last.score:"–";
  $("bigrep").innerHTML=`${n}<small>/${target}</small>`;
  const cues=last?last.faults:[];
  $("cues").innerHTML = last
    ? (cues.length?cues.map(c=>`<li><i class="dot ${last.score>=65?"warn":"bad"}"></i>${c}</li>`).join(""):`<li><i class="dot good"></i>Good rep: full range, ${last.dur}s</li>`)
    : `<li><i class="dot"></i>Do a rep. Form feedback appears after each one.</li>`;
  $("endSetBtn").disabled=!n;
}
function renderSets(){
  $("saveBtn").disabled=!sets.length;
  if(!sets.length){$("setTableWrap").innerHTML=`<p class="empty">Finished sets show up here with reps, accuracy and the most common fault.</p>`;return;}
  $("setTableWrap").innerHTML=`<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Exercise</th><th class="num">Reps</th><th class="num">Acc.</th></tr></thead><tbody>${
    sets.map((s,i)=>`<tr title="${s.top}"><td>${i+1}</td><td>${s.name}<div class="note">${s.top}</div></td><td class="num">${s.reps}</td><td class="num"><span class="pill ${cls(s.acc)}">${s.acc}%</span></td></tr>`).join("")
  }</tbody></table></div>`;
}

/* ---------- history (stored on this device) ---------- */
const HK="formiq.history.v1";
const loadH=()=>{try{return JSON.parse(localStorage.getItem(HK))||[]}catch{return []}};
const saveH=h=>{try{localStorage.setItem(HK,JSON.stringify(h))}catch{}};
function renderHistory(){
  const h=loadH();
  if(!h.length){$("history").innerHTML=`<p class="empty">Saved workouts are kept in this browser.</p>`;return;}
  $("history").innerHTML=h.slice().reverse().map(w=>{
    const reps=w.sets.reduce((t,s)=>t+s.reps,0), acc=Math.round(w.sets.reduce((t,s)=>t+s.acc*s.reps,0)/(reps||1));
    return `<details><summary>${new Date(w.at).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})} · ${w.sets.length} sets · ${reps} reps · <span class="pill ${cls(acc)}">${acc}%</span></summary>
    <table><tbody>${w.sets.map(s=>`<tr><td>${s.name}</td><td class="num">${s.reps}</td><td class="num">${s.acc}%</td></tr>`).join("")}</tbody></table></details>`;}).join("");
}
$("saveBtn").onclick=()=>{finishSet();if(!sets.length)return;const h=loadH();h.push({at:Date.now(),sets});saveH(h);sets=[];renderSets();renderHistory();$("status").textContent="Workout saved to this browser.";};
$("clearHist").onclick=()=>{if($("clearHist").dataset.arm){saveH([]);renderHistory();delete $("clearHist").dataset.arm;$("clearHist").textContent="Clear";}else{$("clearHist").dataset.arm=1;$("clearHist").textContent="Tap again to clear";setTimeout(()=>{delete $("clearHist").dataset.arm;$("clearHist").textContent="Clear";},3000);}};

/* ---------- voice ---------- */
function speak(t){if(!voice||!("speechSynthesis" in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.rate=1.1;speechSynthesis.speak(u);}
$("voiceBtn").onclick=()=>{voice=!voice;$("voiceBtn").textContent="Voice: "+(voice?"on":"off");$("voiceBtn").setAttribute("aria-pressed",voice);};

/* ---------- pose model ---------- */
const MODELS={lite:"pose_landmarker_lite",full:"pose_landmarker_full",heavy:"pose_landmarker_heavy"};
let modelKey=(()=>{try{return localStorage.getItem("formiq.quality")||"full"}catch{return "full"}})();
let visionFiles=null;
async function loadModel(){
  if(landmarker) return;
  $("status").textContent=`Loading ${$("quality").selectedOptions[0].text.toLowerCase()} tracking model…`;
  const files=visionFiles||(visionFiles=await FilesetResolver.forVisionTasks(new URL("vendor/mediapipe/wasm",location.href).href));
  const opts=d=>({baseOptions:{modelAssetPath:new URL(`vendor/models/${MODELS[modelKey]}.task`,location.href).href,delegate:d},runningMode:"VIDEO",numPoses:1,
    minPoseDetectionConfidence:0.5,minPosePresenceConfidence:0.4,minTrackingConfidence:0.4});
  let delegate="GPU";
  try{landmarker=await PoseLandmarker.createFromOptions(files,opts("GPU"));}
  catch{
    try{landmarker=await PoseLandmarker.createFromOptions(files,opts("CPU"));delegate="CPU";}
    catch(err){$("status").textContent="Couldn't load the pose model. Check your connection, or turn off Brave Shields for this site, and try again.";throw err;}
  }
  $("status").textContent= delegate==="GPU" ? "Tracking with graphics acceleration." :
    "Tracking without graphics acceleration, so it may be slow. In Brave, turn Shields off for this site, or switch Tracking to Fast.";
}

const BONES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function draw(lm){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!lm) return;
  const W=canvas.width,H=canvas.height;
  ctx.lineWidth=Math.max(3,W/180); ctx.strokeStyle="rgba(60,207,142,.9)"; ctx.lineCap="round";
  BONES.forEach(([a,b])=>{if((lm[a].visibility??1)<VIS||(lm[b].visibility??1)<VIS)return;ctx.beginPath();ctx.moveTo(lm[a].x*W,lm[a].y*H);ctx.lineTo(lm[b].x*W,lm[b].y*H);ctx.stroke();});
  ctx.fillStyle="#fff";
  [11,12,13,14,15,16,23,24,25,26,27,28].forEach(i=>{if((lm[i].visibility??1)<VIS)return;ctx.beginPath();ctx.arc(lm[i].x*W,lm[i].y*H,ctx.lineWidth*1.2,0,7);ctx.fill();});
}

function loop(){
  if(!running) return;
  if(video.readyState>=2 && video.currentTime!==lastTs){
    lastTs=video.currentTime;
    if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}
    let res;
    try{ res=landmarker.detectForVideo(video,performance.now()); }
    catch(err){ $("status").textContent="Pose tracking error: "+(err.message||err); schedule(); return; }
    const t=performance.now(); fpsN++; if(t-fpsT>1000){fps=Math.round(fpsN*1000/(t-fpsT));fpsN=0;fpsT=t;}
    const raw=res.landmarks?.[0], rawW=res.worldLandmarks?.[0];
    if(raw){
      IMG=smoothLm("img",raw,t,1.7,0.8); W=rawW?smoothLm("world",rawW,t,1.7,0.8):null;
      draw(IMG); analyze(IMG);
    } else { filters={}; IMG=W=null; draw(null); setPhase("No person"); hud([["No person detected","warn"],[fps+" fps",""]]); }
  }
  schedule();
}
function schedule(){ if(video.requestVideoFrameCallback) video.requestVideoFrameCallback(()=>loop()); else requestAnimationFrame(loop); }

/* ---------- consent (shown once per browser, again if the terms version changes) ---------- */
const CONSENT_KEY="formiq.consent", CONSENT_VER="2026-10-10";
function hasConsent(){try{return localStorage.getItem(CONSENT_KEY)===CONSENT_VER}catch{return false}}
function ensureConsent(){
  if(hasConsent()) return Promise.resolve(true);
  return new Promise(res=>{
    const m=$("consent"), box=$("consentBox"), ok=$("consentOk");
    box.checked=false; ok.disabled=true; m.hidden=false; box.focus();
    box.onchange=()=>ok.disabled=!box.checked;
    ok.onclick=()=>{try{localStorage.setItem(CONSENT_KEY,CONSENT_VER)}catch{} m.hidden=true; res(true);};
    $("consentCancel").onclick=()=>{m.hidden=true; res(false);};
  });
}

window.formiqEnsureConsent=ensureConsent;

/* ---------- tabs ---------- */
const TABS=["workout","food","activity","ride"];
function showTab(name){
  for(const t of TABS){ const T=t[0].toUpperCase()+t.slice(1); $("tab"+T).setAttribute("aria-selected",name===t); $(t+"View").hidden=name!==t; }
  document.dispatchEvent(new CustomEvent("formiq:camera",{detail:"tab-"+name}));
  try{history.replaceState(null,"",name==="workout"?location.pathname+location.search:"#"+name)}catch{}
}
for(const t of TABS) $("tab"+t[0].toUpperCase()+t.slice(1)).onclick=()=>showTab(t);
document.addEventListener("formiq:showtab",e=>showTab(e.detail));
document.addEventListener("formiq:camera",e=>{ if(e.detail!=="workout" && e.detail!=="tab-workout" && running && stream){ stopSource(); $("camBtn").textContent="Start camera"; $("flipBtn").disabled=true; finishSet(); } });

/* ---------- sources ---------- */
async function startCamera(){
  if(!await ensureConsent()) return;
  document.dispatchEvent(new CustomEvent("formiq:camera",{detail:"workout"}));
  try{
    $("startBtn").disabled=true; $("camBtn").disabled=true;
    await loadModel();
    stopSource(); filters={};
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:640},height:{ideal:480},frameRate:{ideal:30}},audio:false});
    video.srcObject=stream;
    await new Promise(r=>{ if(video.readyState>=1) r(); else video.onloadedmetadata=()=>r(); });
    await video.play();
    const mirror=facing==="user"; video.classList.toggle("mirror",mirror); canvas.classList.toggle("mirror",mirror);
    $("overlay").hidden=true; $("bigrep").hidden=false; $("flipBtn").disabled=false; $("camBtn").textContent="Stop camera";
    running=true; loop();
  }catch(e){
    $("ovTitle").textContent="Camera unavailable";
    $("ovText").textContent= e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in your browser's site settings, then try again.":
      location.protocol==="http:"&&location.hostname!=="localhost"?"Browsers only allow the camera on https pages. Open this app from an https address.":
      "Couldn't start the camera ("+(e.message||e.name)+"). You can still analyze a recorded video.";
    $("overlay").hidden=false; $("status").textContent="";
  }finally{$("startBtn").disabled=false;$("camBtn").disabled=false;}
}
function stopSource(){running=false;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
$("startBtn").onclick=startCamera;
$("camBtn").onclick=()=>{if(running&&stream){stopSource();$("camBtn").textContent="Start camera";$("flipBtn").disabled=true;finishSet();}else startCamera();};
$("flipBtn").onclick=()=>{facing=facing==="user"?"environment":"user";startCamera();};
$("endSetBtn").onclick=finishSet;
$("videoFile").onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  await loadModel(); stopSource(); filters={};
  video.srcObject=null; video.src=URL.createObjectURL(f); video.classList.remove("mirror"); canvas.classList.remove("mirror");
  video.onended=()=>{finishSet();running=false;$("status").textContent="Video analyzed.";};
  await video.play(); $("overlay").hidden=true; $("bigrep").hidden=false; running=true; lastTs=-1; loop();
};
$("quality").value=modelKey;
$("quality").onchange=async()=>{
  modelKey=$("quality").value; try{localStorage.setItem("formiq.quality",modelKey)}catch{}
  const wasRunning=running; running=false;
  try{landmarker?.close();}catch{} landmarker=null; filters={};
  await loadModel(); if(wasRunning){running=true;lastTs=-1;loop();}
};
$("fileBtn").onclick=async()=>{ if(await ensureConsent()) $("videoFile").click(); };
$("targetReps").oninput=()=>renderLive();

/* keep the screen awake during a workout */
async function wake(){try{await navigator.wakeLock?.request("screen");}catch{}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&running)wake();});
video.addEventListener("playing",wake);

renderEx(); renderLive(); renderSets(); renderHistory();
initFood(); initAI(); initActivity(); initRide();
if(TABS.includes(location.hash.slice(1))) showTab(location.hash.slice(1));
addEventListener("hashchange",()=>{const h=location.hash.slice(1); if(TABS.includes(h)) showTab(h);});

/* ---------- delete all data stored by FormIQ on this device ---------- */
$("wipeBtn").onclick=()=>{const b=$("wipeBtn");
  if(!b.dataset.arm){b.dataset.arm=1;b.textContent="Tap again to delete everything";setTimeout(()=>{delete b.dataset.arm;b.textContent="Delete all my data"},4000);return;}
  window.FormIQSecure.wipe();};

/* ---------- privacy and security panel ---------- */
async function renderSecurity(){
  const S=window.FormIQSecure, st=$("secStatus"), box=$("secLock");
  st.textContent = S.status==="memory" ? "Private window: nothing is saved on this device." :
    S.status==="unreadable" ? "Saved data couldn't be opened. It stays encrypted; delete it to start fresh." :
    window.FormIQNative ? "Your data is encrypted on this phone with a key held in its secure hardware." : "Your data is encrypted on this device (AES-256).";
  if(S.status==="memory"){ box.innerHTML=""; return; }
  if(window.FormIQNative){
    let l={available:false,on:false}; try{ l=await window.FormIQNative.call("lockStatus"); }catch{}
    box.innerHTML = !l.available ? `<p class="muted">Set a screen lock on your phone to be able to lock FormIQ with your fingerprint, face or PIN.</p>` :
      `<label class="check" for="lockOn"><input type="checkbox" id="lockOn" ${l.on?"checked":""}> Require fingerprint, face or screen lock to open FormIQ (also hides FormIQ from screenshots and the recent-apps screen)</label>`;
    const c=$("lockOn"); if(c) c.onchange=async()=>{ try{ await window.FormIQNative.call("lockSet",{on:c.checked}); }catch(e){ c.checked=!c.checked; } renderSecurity(); };
    return;
  }
  if(S.locked){
    box.innerHTML=`<p class="muted">Locked with a passcode. Your data can only be opened with it.</p><div class="secrow"><button type="button" id="passOff">Remove passcode</button></div>`;
    $("passOff").onclick=async()=>{ await S.removePasscode(); renderSecurity(); };
  } else {
    box.innerHTML=`<p class="muted">Add a passcode so nobody else using this device can open your data. If you forget it, the data can't be recovered.</p>
      <form class="secrow" id="passForm"><input type="password" id="pass1" autocomplete="new-password" placeholder="New passcode (6+ characters)" aria-label="New passcode" minlength="6" required>
      <input type="password" id="pass2" autocomplete="new-password" placeholder="Repeat passcode" aria-label="Repeat passcode" minlength="6" required><button type="submit">Lock with passcode</button></form><p class="muted" id="passMsg" role="status"></p>`;
    $("passForm").onsubmit=async e=>{ e.preventDefault(); const a=$("pass1").value,b=$("pass2").value;
      if(a!==b){ $("passMsg").textContent="The two passcodes don't match."; return; }
      try{ $("passMsg").textContent="Encrypting…"; await S.setPasscode(a); $("pass1").value=$("pass2").value=""; renderSecurity(); }catch(err){ $("passMsg").textContent=err.message; } };
  }
}
renderSecurity();
