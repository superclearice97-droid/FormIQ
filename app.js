/* FormIQ main script: workout tracking, tabs, consent and app wiring. */
import "./secure.js?v=27";
import { PoseLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";
import { initFood } from "./food.js?v=27";
import { initAI } from "./ai.js?v=27";
import { initActivity } from "./activity.js?v=27";
import { initRide } from "./ride.js?v=27";
import { EX, CATS, CIRCUITS, createTracker } from "./reps.js?v=27";
import { evaluate, createGuide } from "./guide.js?v=27";
import { COACH } from "./coach-data.js?v=27";
import { createBuddy, setLook, getLook } from "./buddy3d.js?v=27";
import { HAIR_STYLES, HAIR_COLORS, SKIN, EYES, TOP_COLORS, BOTTOM_COLORS, SHOE_COLORS, ACCENT_COLORS, PROPORTIONS, BUILDS, TOPS, BOTTOMS, DEFAULT_LOOK, randomLook, saveLook, loadLook } from "./looks.js?v=27";

const $ = id => document.getElementById(id);
const video=$("video"), canvas=$("canvas"), ctx=canvas.getContext("2d");

/* Rep counting, depth and form checks live in reps.js (tested on recorded workouts). */
const VIS=0.35;
/* ---------- state ---------- */
let fps=0,fpsN=0,fpsT=performance.now();
let poseLatencyMs=0,poseLatencyPeakMs=0,poseSamples=0;
let landmarker=null, stream=null, facing="user", running=false, voice=true, lastTs=-1;
let exKey="squat";
const tracker=createTracker(exKey);
let set=newSet(), sets=[], restTimer=null, lastRepAt=0;
function newSet(){return {ex:exKey,reps:[],started:Date.now()};}

/* ---------- customize the coach ---------- */
function renderLookUI(){
  const L=getLook(), box=$("lookUI");
  const sw=(label,list,key)=>`<div class="lk"><b>${label}</b><div class="sw" role="group" aria-label="${label}">${list.map((c,i)=>`<button type="button" class="swb" data-k="${key}" data-v="${i}" aria-label="${esc(c.name)}" title="${esc(c.name)}" aria-pressed="${L[key]===i}" style="background:${c.hex}"></button>`).join("")}</div></div>`;
  const sel=(label,key,opts)=>`<label class="lk"><b>${label}</b><select data-s="${key}">${opts.map(([v,n])=>`<option value="${v}"${L[key]===v?" selected":""}>${esc(n)}</option>`).join("")}</select></label>`;
  const seg=(label,key,obj)=>`<div class="lk"><b>${label}</b><div class="row2" role="group" aria-label="${label}">${Object.entries(obj).map(([v,o])=>`<button type="button" data-g="${key}" data-v="${v}" aria-pressed="${L[key]===v}">${esc(o.name||o)}</button>`).join("")}</div></div>`;
  const ck=(label,key)=>`<label class="ck"><input type="checkbox" data-c="${key}"${L[key]?" checked":""}> ${label}</label>`;
  box.innerHTML=`${sel("Hairstyle","hair",HAIR_STYLES.map(h=>[h.id,h.name]))}${sw("Hair colour",HAIR_COLORS,"hairColor")}${sw("Skin tone",SKIN,"skin")}${sw("Eyes",EYES,"eyes")}
    ${seg("Proportions","prop",PROPORTIONS)}${seg("Build","build",BUILDS)}
    ${sel("Top","top",Object.entries(TOPS))}${sw("Top colour",TOP_COLORS,"topColor")}
    ${sel("Bottoms","bottom",Object.entries(BOTTOMS))}${sw("Bottoms colour",BOTTOM_COLORS,"bottomColor")}${sw("Shoes",SHOE_COLORS,"shoes")}
    <div class="lk"><b>Extras</b>${ck("Headband","band")}${L.band?sw("Headband colour",ACCENT_COLORS,"bandColor"):""}${ck("Wristbands","wrist")}${L.wrist?sw("Wristband colour",ACCENT_COLORS,"wristColor"):""}${ck("Fingerless gloves","gloves")}${ck("Glasses","glasses")}</div>
    <div class="row2"><button type="button" id="lookRand">Surprise me</button><button type="button" id="lookReset">Reset</button></div>`;
}
function applyLook(l){ setLook(l); saveLook(getLook()); renderLookUI(); }
$("lookUI").addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  if(b.id==="lookRand") return applyLook(randomLook());
  if(b.id==="lookReset") return applyLook({...DEFAULT_LOOK});
  if(b.dataset.k) return applyLook({...getLook(),[b.dataset.k]:+b.dataset.v});
  if(b.dataset.g) return applyLook({...getLook(),[b.dataset.g]:b.dataset.v});
});
$("lookUI").addEventListener("change",e=>{
  const t=e.target; if(t.dataset.s) applyLook({...getLook(),[t.dataset.s]:t.value}); else if(t.dataset.c) applyLook({...getLook(),[t.dataset.c]:t.checked});
});

/* ---------- auto-frame: digital pan and zoom that follows you so you stay centred and a good size ---------- */
let autoFrame=(()=>{try{return localStorage.getItem("formiq.autoframe")!=="off"}catch{return true}})();
const camView={z:1,x:0,y:0}; let camT=0, camLostAt=0;
function paintAutoBtn(){ $("autoBtn").textContent="Auto-frame: "+(autoFrame?"on":"off"); $("autoBtn").setAttribute("aria-pressed",autoFrame); }
function applyCam(){ $("cam").style.transform=camView.z===1&&!camView.x&&!camView.y?"":`scale(${camView.z.toFixed(4)}) translate(${(-camView.x).toFixed(1)}px,${(-camView.y).toFixed(1)}px)`; }
function resetCam(){ camView.z=1; camView.x=0; camView.y=0; camT=0; applyCam(); }
$("autoBtn").onclick=()=>{ autoFrame=!autoFrame; try{localStorage.setItem("formiq.autoframe",autoFrame?"on":"off")}catch{} paintAutoBtn(); if(!autoFrame) resetCam(); };
function stageRect(){
  const W=$("stage").clientWidth, H=$("stage").clientHeight, a=(video.videoWidth||4)/(video.videoHeight||3);
  let dw=W, dh=W/a; if(dh>H){ dh=H; dw=H*a; }
  return {W,H,dw,dh,ox:(W-dw)/2,oy:(H-dh)/2};
}
const clampWin=(pos,size,lo,span)=>size>=span?lo+(span-size)/2:Math.max(lo,Math.min(lo+span-size,pos));
function autoFrameStep(r,t){
  if(!autoFrame||!video.srcObject){ if(camView.z!==1) resetCam(); return; }
  const S=stageRect(), mirror=video.classList.contains("mirror"), lm=r.img;
  let tz=camView.z, tx=camView.x, ty=camView.y;
  const pts=lm?lm.filter((p,i)=>i<=32&&(p.visibility??1)>VIS):[];
  if(pts.length>=5){
    camLostAt=0;
    const X=pts.map(p=>S.ox+(mirror?1-p.x:p.x)*S.dw), Y=pts.map(p=>S.oy+p.y*S.dh);
    const x0=Math.min(...X), x1=Math.max(...X), y0=Math.min(...Y)-0.07*S.dh, y1=Math.max(...Y)+0.03*S.dh;
    const bw=Math.max(40,x1-x0), bh=Math.max(60,y1-y0), cx=(x0+x1)/2, cy=(y0+y1)/2;
    const nz=Math.max(1,Math.min(2.2,0.8*S.dh/bh,0.85*S.dw/bw));
    const w=S.W/nz, h=S.H/nz;
    const nx=clampWin(cx-w/2,w,S.ox,S.dw), ny=clampWin(cy-h/2,h,S.oy,S.dh);
    // ignore small changes so the picture doesn't wobble
    if(Math.abs(nz-camView.z)>0.06*camView.z || Math.abs(nx-camView.x)>0.05*w || Math.abs(ny-camView.y)>0.05*h){ tz=nz; tx=nx; ty=ny; }
  } else {
    if(!camLostAt) camLostAt=t;
    if(t-camLostAt>3000){ tz=1; tx=0; ty=0; }
  }
  const dt=camT?Math.min(200,t-camT):16; camT=t;
  const k=1-Math.exp(-dt/550);
  camView.z+=(tz-camView.z)*k; camView.x+=(tx-camView.x)*k; camView.y+=(ty-camView.y)*k;
  applyCam();
}

/* ---------- setup guide: walks you into the picture, counts 3-2-1, then reps start counting ---------- */
const guide=createGuide();
let guideOn=(()=>{try{return localStorage.getItem("formiq.guide")!=="off"}catch{return true}})(), goUntil=0;
function paintGuideBtn(){ $("guideBtn").textContent="Setup guide: "+(guideOn?"on":"off"); $("guideBtn").setAttribute("aria-pressed",guideOn); }
$("guideBtn").onclick=()=>{ guideOn=!guideOn; try{localStorage.setItem("formiq.guide",guideOn?"on":"off")}catch{} paintGuideBtn(); guide.reset(); if(!guideOn) showGuide(null); };
$("gSkip").onclick=()=>{ guide.start(); tracker.rearm(); showGuide(null); speak("Go"); };
/* chibi coach: demo in the exercise panel, and a pop-up on the camera view whenever you need to (re)align */
const panelBuddy=createBuddy($("howDemo")), popBuddy=createBuddy($("popDemo"));
let popKey="", demoPinned=false;
function setPopup(on){
  const card=$("demoCard");
  if(on){
    if(popKey!==exKey){ popBuddy.set(exKey); popKey=exKey; }
    $("popName").textContent=EX[exKey].name;
    if(card.hidden){ card.hidden=false; popBuddy.play(); }
  } else if(!card.hidden){ card.hidden=true; popBuddy.stop(); }
}
$("demoBtn").onclick=()=>{ demoPinned=!demoPinned; $("demoBtn").setAttribute("aria-pressed",demoPinned); $("demoBtn").textContent=demoPinned?"Hide demo":"Show demo"; setPopup(demoPinned||!$("guide").hidden&&!guideDone()); };
const guideDone=()=>guide.started;
function showGuide(g){
  setPopup(demoPinned||!!g&&(g.phase==="guide"||g.phase==="paused"||g.phase==="count"));
  const el=$("guide");
  if(!g){ el.hidden=true; return; }
  el.hidden=false;
  const mirror=video.classList.contains("mirror"), W=$("stage").clientWidth, H=$("stage").clientHeight, a=(video.videoWidth||4)/(video.videoHeight||3);
  let dw=W, dh=W/a, ox=0, oy=0; if(dh>H){ dh=H; dw=H*a; }
  ox=(W-dw)/2; oy=(H-dh)/2;
  const b=g.box, bx=$("gBox");
  if(b){
    const x0=mirror?1-b.x1:b.x0, x1=mirror?1-b.x0:b.x1, y0=Math.max(0,b.y0), y1=Math.min(1,b.y1);
    const z=autoFrame&&video.srcObject?camView.z:1, vx=z>1?camView.x:0, vy=z>1?camView.y:0;
    bx.style.display="block"; bx.style.left=((ox+x0*dw-vx)*z)+"px"; bx.style.top=((oy+y0*dh-vy)*z)+"px"; bx.style.width=((x1-x0)*dw*z)+"px"; bx.style.height=((y1-y0)*dh*z)+"px";
  } else bx.style.display="none";
  bx.classList.toggle("ok",g.phase==="count"||g.phase==="go");
  const ar=$("gArrow");
  if(g.arrow){ const right=(g.arrow==="toRight")!==mirror; ar.hidden=false; ar.textContent=right?"→":"←"; ar.className="garrow "+(right?"r":"l"); ar.style.setProperty("--n",right?"-12px":"12px"); } else ar.hidden=true;
  const c=$("gCount"); c.hidden=!(g.phase==="count"||g.phase==="go"); c.textContent=g.phase==="go"?"Go!":g.count;
  const m=$("gMsg"); m.className="gmsg"+(g.phase==="count"||g.phase==="go"?" ok":"");
  m.hidden=g.phase==="go"; m.textContent=g.phase==="count"?"Hold still…":(g.msg||"");
  $("gSkip").hidden=g.phase==="go";
}
/* true when reps may be counted this frame */
function guideStep(r,t){
  if(!guideOn||!video.srcObject){ if(!$("guide").hidden) showGuide(null); return true; }
  if(!$("restPanel").hidden){ guide.reset(); showGuide(null); return false; }
  const e=evaluate(r.img||null, EX[exKey], (video.videoWidth||4)/(video.videoHeight||3), r.postureOk!==false, r.postureHint, {auto:autoFrame, relax:guide.relax});
  const g=guide.step(e,t);
  if(g.say) speak(g.say==="Go!"&&COACH[exKey]?"Go. "+COACH[exKey].cue:g.say);
  if(g.phase==="go"){ tracker.rearm(); goUntil=t+900; showGuide(g); showCoachLine(0); return false; }
  if(g.phase==="live"){ if(t<goUntil) showGuide({phase:"go",box:g.box}); else showGuide(null); return true; }
  $("coachLine").hidden=true; showGuide(g); return false;
}

/* ---------- UI: exercise picker, how-to and circuits ---------- */
let exCat=EX[exKey].cat, circuit=null, stretchKind="dynamic";   // circuit: {c: circuit, i: step index}
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const isHold=k=>EX[k].kind==="hold";
function renderEx(){
  $("exCats").innerHTML=CATS.map(([k,n])=>`<button type="button" role="tab" data-c="${k}" aria-selected="${k===exCat}">${n}</button>`).join("");
  $("exCats").querySelectorAll("button").forEach(b=>b.onclick=()=>{exCat=b.dataset.c;renderEx();});
  const sub=$("exSub"); sub.hidden=exCat!=="stretch";
  if(exCat==="stretch"){
    sub.innerHTML=[["dynamic","Warm-up (moving)"],["static","Cool-down (holds)"]].map(([k,n])=>`<button type="button" data-s="${k}" aria-pressed="${k===stretchKind}">${n}</button>`).join("");
    sub.querySelectorAll("button").forEach(b=>b.onclick=()=>{stretchKind=b.dataset.s;renderEx();});
  }
  $("exList").innerHTML=Object.entries(EX).filter(([,e])=>e.cat===exCat&&(exCat!=="stretch"||e.stretch===stretchKind)).map(([k,e])=>`<button type="button" data-k="${k}" aria-pressed="${k===exKey}">${esc(e.name)}<small>${esc(e.view)}${e.kind==="hold"?" · hold":""}</small></button>`).join("");
  $("exList").querySelectorAll("button").forEach(b=>b.onclick=()=>{ if(circuit){circuit=null;renderCircuit();$("circuitSel").value="";} selectExercise(b.dataset.k); });
  const e=EX[exKey];
  $("howTitle").textContent=`How to do it: ${e.name}`;
  $("howText").textContent=e.how;
  $("howView").textContent=`Camera: ${e.view} view, ${({full:"your whole body in the picture (the coach settles for less if your space is tight)",knees:"head to knees is enough, no need to show your feet",upper:"head to hips is enough, you can stand close",hang:"your head and arms on the bar"})[e.frame||"full"]}.`+(e.kind==="hold"?" Counts the seconds you hold the pose.":e.kind==="alt"?" Each side counts as one.":"");
  $("targetLbl").textContent=isHold(exKey)?"Seconds per set":"Reps per set";
  panelBuddy.set(exKey); if(!running) panelBuddy.play(); else panelBuddy.stop();
  const c=COACH[exKey];
  $("coachBox").innerHTML=!c?"":`<div class="coach"><h4>Works</h4><div class="musc">${c.muscles.split(", ").map(m=>`<span>${esc(m)}</span>`).join("")}</div>
    <h4>Step by step</h4><ol>${c.steps.map(t=>`<li>${esc(t)}</li>`).join("")}</ol>
    <h4>Common mistakes</h4><ul>${c.mistakes.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>
    <h4>Breathing</h4><p>${esc(c.breath)}</p>
    <h4>Easier</h4><p>${esc(c.easier)}</p><h4>Harder</h4><p>${esc(c.harder)}</p>
    <p class="note">General fitness information, not medical advice. Stop if you feel pain, dizziness or chest discomfort.</p></div>`;
}
function selectExercise(k,target){
  if(set.reps.length) finishSet(true);
  exKey=k; exCat=EX[k].cat; if(EX[k].stretch) stretchKind=EX[k].stretch; set=newSet(); tracker.setExercise(k); guide.reset();
  $("targetReps").value=target??EX[k].target;
  renderEx(); renderLive();
}
function renderCircuit(){
  if(!circuit){ $("circuitOut").textContent=""; return; }
  const st=circuit.c.steps;
  $("circuitOut").textContent=`${circuit.c.name}: step ${circuit.i+1} of ${st.length}`+(circuit.i+1<st.length?` · next: ${EX[st[circuit.i+1][0]].name}`:" · last one");
}
$("circuitSel").innerHTML=`<option value="">None (pick exercises yourself)</option>`+CIRCUITS.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
$("circuitSel").onchange=()=>{
  const c=CIRCUITS.find(x=>x.id===$("circuitSel").value);
  if(!c){ circuit=null; renderCircuit(); return; }
  circuit={c,i:0}; selectExercise(...c.steps[0]); renderCircuit();
  speak(`${c.name}. First: ${EX[c.steps[0][0]].name}.`);
};

/* ---------- per-frame analysis ---------- */
function analyze(r){
  const def=EX[exKey];
  if(r.state==="noperson"){ setPhase("No person"); hud([["No person detected","warn"],[fps+" fps",""]]); return; }
  if(r.state==="hold") return;   // brief dropout (a hand passing the body, motion blur): keep the rep alive
  if(r.state==="lost"){ setPhase("Not in frame"); hud([[fps+" fps",""],[r.framing||(def.view==="side"?"Turn so your side faces the camera":"Make sure your whole body is in view"),"warn"]]); return; }
  if(r.state==="posture"){ $("romBar").style.width="0%"; setPhase("Waiting"); hud([[r.hint,"warn"],[fps+" fps",fps&&fps<10?"warn":""]].concat(r.framing?[[r.framing,"warn"]]:[])); return; }
  if(r.rep) countRep(r.rep);
  else if(r.skip&&video.srcObject){ const el=$("coachLine"); el.hidden=false; el.textContent=r.skip; }
  $("romBar").style.width=r.prog*100+"%";
  setPhase(r.phase==="calibrating"?"Get set…":r.phase==="holding"?"Holding":def.kind==="hold"?"Get into the pose":r.phase==="top"?"Ready":r.phase==="bottom"?"Return":"Moving");
  hud([[r.label,""]].concat(r.hint?[[r.hint,"warn"]]:[]).concat([[r.quality>0.75?"Tracking good":"Tracking weak",r.quality>0.75?"good":"warn"],[fps+" fps",fps&&fps<10?"warn":""]]).concat(r.framing?[[r.framing,"warn"]]:[]));
}

function countRep(res){
  set.reps.push(res); lastRepAt=Date.now();
  renderLive(res);
  const n=set.reps.length, target=+$("targetReps").value||10, def=EX[exKey];
  // say every rep for strength moves; for fast cardio, alternating sides and holds, every 5th (or 10th)
  const every=def.kind==="hold"?5:(def.cat==="cardio"||def.kind==="alt")?(target>=40?10:5):1;
  if(n%every===0 || (def.kind==="hold" && target-n<=3 && target-n>0)) speak(def.kind==="hold"&&target-n<=3&&target-n>0?String(target-n):String(n));
  if(n>=target) finishSet();
}

/* ---------- sets & rest ---------- */
function summarize(s){
  const n=s.reps.length, acc=n?Math.round(s.reps.reduce((t,r)=>t+r.score,0)/n):0;
  const counts={}; s.reps.forEach(r=>r.faults.forEach(f=>counts[f]=(counts[f]||0)+1));
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const unit=EX[s.ex].kind==="hold"?"sec":"reps";
  return {ex:s.ex,name:EX[s.ex].name,reps:n,unit,acc,top:top?`${top[0]} (${top[1]}×)`:unit==="sec"?"Held in good form":"Clean set",at:s.started};
}
function finishSet(switching){
  if(!set.reps.length) return;
  const sm=summarize(set); sets.push(sm);
  set=newSet(); tracker.setExercise(exKey); guide.reset(); renderSets(); renderLive();
  if(switching) return;
  if(circuit){   // circuits move on to the next exercise by themselves
    circuit.i++;
    if(circuit.i>=circuit.c.steps.length){ speak(`Circuit complete. Great work.`); circuit=null; $("circuitSel").value=""; renderCircuit(); startRest(); return; }
    const [k,tg]=circuit.c.steps[circuit.i];
    speak(`Done. Next: ${EX[k].name}.`); selectExercise(k,tg); renderCircuit(); startRest(); return;
  }
  speak(sm.unit==="sec"?`Done. ${sm.reps} seconds.`:`Set done. ${sm.reps} reps, ${sm.acc} percent.`);
  startRest();
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
  $("repsOut").textContent=n; $("repsUnit").textContent=isHold(exKey)?"seconds":"reps";
  const acc=n?Math.round(set.reps.reduce((t,r)=>t+r.score,0)/n):null;
  $("accOut").textContent=acc==null?"–":acc+"%";
  $("lastOut").textContent=last?last.score:"–";
  $("bigrep").innerHTML=isHold(exKey)?`${n}<small>/${target}s</small>`:`${n}<small>/${target}</small>`;
  const cues=last?last.faults:[];
  $("cues").innerHTML = last
    ? (cues.length?cues.map(c=>`<li><i class="dot ${last.score>=65?"warn":"bad"}"></i>${c}</li>`).join(""):`<li><i class="dot good"></i>Good rep: full range, ${last.dur}s</li>`)
    : `<li><i class="dot"></i>${isHold(exKey)?"Get into the pose. The timer runs while your form is right.":"Do a rep. Form feedback appears after each one."}</li>`;
  $("endSetBtn").disabled=!n;
  showCoachLine(n);
}
function showCoachLine(n){
  const el=$("coachLine"), c=COACH[exKey];
  if(!c||!running||!video.srcObject||(guideOn&&!guide.started)){ el.hidden=true; return; }
  el.hidden=false;
  const fault=last_fault();
  el.textContent=fault?`Watch: ${fault}`:`${isHold(exKey)?"Hold":"Step "+((n%c.steps.length)+1)}: ${c.steps[n%c.steps.length]}`;
}
function last_fault(){ const r=set.reps[set.reps.length-1]; return r&&r.faults&&r.faults.length&&r.score<85?r.faults[0]:""; }
function renderSets(){
  $("saveBtn").disabled=!sets.length;
  if(!sets.length){$("setTableWrap").innerHTML=`<p class="empty">Finished sets show up here with reps, accuracy and the most common fault.</p>`;return;}
  $("setTableWrap").innerHTML=`<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Exercise</th><th class="num">Reps</th><th class="num">Acc.</th></tr></thead><tbody>${
    sets.map((s,i)=>`<tr title="${s.top}"><td>${i+1}</td><td>${s.name}<div class="note">${s.top}</div></td><td class="num">${s.reps}${s.unit==="sec"?" s":""}</td><td class="num"><span class="pill ${cls(s.acc)}">${s.acc}%</span></td></tr>`).join("")
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
    <table><tbody>${w.sets.map(s=>`<tr><td>${s.name}</td><td class="num">${s.reps}${s.unit==="sec"?" s":""}</td><td class="num">${s.acc}%</td></tr>`).join("")}</tbody></table></details>`;}).join("");
}
$("saveBtn").onclick=()=>{finishSet(true);if(!sets.length)return;const h=loadH();h.push({at:Date.now(),sets});saveH(h);sets=[];renderSets();renderHistory();$("status").textContent="Workout saved to this browser.";};
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

function loop(_now,meta){
  if(!running) return;
  if(video.readyState>=2 && video.currentTime!==lastTs){
    lastTs=video.currentTime;
    if(canvas.width!==video.videoWidth){canvas.width=video.videoWidth;canvas.height=video.videoHeight;}
    let res;
    const inferStart=performance.now();
    try{ res=landmarker.detectForVideo(video,inferStart); }
    catch(err){ $("status").textContent="Pose tracking error: "+(err.message||err); schedule(); return; }
    const t=performance.now();
    const latency=t-inferStart;
    poseLatencyMs=poseSamples?poseLatencyMs*0.9+latency*0.1:latency;
    poseLatencyPeakMs=Math.max(poseLatencyPeakMs,latency);
    poseSamples++;
    fpsN++; if(t-fpsT>1000){fps=Math.round(fpsN*1000/(t-fpsT));fpsN=0;fpsT=t;}
    // the camera's own capture time keeps the spacing between frames steady even when inference time varies
    const capT=meta&&(meta.captureTime||meta.presentationTime);
    const r=tracker.update(res.landmarks?.[0]||null, res.worldLandmarks?.[0]||null, video.srcObject?(capT>0&&Math.abs(capT-t)<1000?capT:t):video.currentTime*1000, (video.videoWidth||4)/(video.videoHeight||3));
    draw(r.img||null); autoFrameStep(r,t);
    if(guideStep(r,t)) analyze(r);
    else { setPhase(guide.started?"Go":"Getting ready"); hud([[fps+" fps",fps&&fps<10?"warn":""]]); $("romBar").style.width="0%"; }
  }
  schedule();
}
window.FormIQTrackingDiagnostics=()=>({fps,meanInferenceMs:Number(poseLatencyMs.toFixed(1)),peakInferenceMs:Number(poseLatencyPeakMs.toFixed(1)),samples:poseSamples,model:modelKey});
function schedule(){ if(video.requestVideoFrameCallback) video.requestVideoFrameCallback((n,m)=>loop(n,m)); else requestAnimationFrame(loop); }

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
document.addEventListener("formiq:camera",e=>{ if(e.detail!=="workout" && e.detail!=="tab-workout" && running && stream){ stopSource(); $("camBtn").textContent="Start camera"; $("flipBtn").disabled=true; finishSet(true); } });

/* ---------- sources ---------- */
async function startCamera(){
  if(!await ensureConsent()) return;
  document.dispatchEvent(new CustomEvent("formiq:camera",{detail:"workout"}));
  try{
    $("startBtn").disabled=true; $("camBtn").disabled=true;
    await loadModel();
    stopSource(); tracker.resetSmoothing(); tracker.setExercise(exKey); guide.reset();
    stream=await navigator.mediaDevices.getUserMedia({video:{...(camDev?{deviceId:{exact:camDev}}:{facingMode:facing}),width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
    video.srcObject=stream;
    await new Promise(r=>{ if(video.readyState>=1) r(); else video.onloadedmetadata=()=>r(); });
    await video.play();
    const mirror=camDev?!/back|rear|environment/i.test((stream.getVideoTracks()[0]?.label)||""):facing==="user"; video.classList.toggle("mirror",mirror); canvas.classList.toggle("mirror",mirror);
    $("overlay").hidden=true; $("bigrep").hidden=false; $("flipBtn").disabled=false; $("camBtn").textContent="Stop camera";
    running=true; panelBuddy.stop(); loop();
  }catch(e){
    $("ovTitle").textContent="Camera unavailable";
    $("ovText").textContent= e.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in your browser's site settings, then try again.":
      location.protocol==="http:"&&location.hostname!=="localhost"?"Browsers only allow the camera on https pages. Open this app from an https address.":
      "Couldn't start the camera ("+(e.message||e.name)+"). You can still analyze a recorded video.";
    $("overlay").hidden=false; $("status").textContent="";
  }finally{$("startBtn").disabled=false;$("camBtn").disabled=false;}
}
function stopSource(){running=false;resetCam();panelBuddy.play();if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
$("startBtn").onclick=startCamera;
$("camBtn").onclick=()=>{if(running&&stream){stopSource();$("camBtn").textContent="Start camera";$("flipBtn").disabled=true;finishSet(true);}else startCamera();};
let camDev=null;   // a specific camera chosen on a computer with several
$("flipBtn").onclick=async()=>{
  try{
    const cams=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");
    const phone=/Android|iPhone|iPad/i.test(navigator.userAgent);
    if(cams.length>1&&!phone){ const cur=camDev||stream?.getVideoTracks()[0]?.getSettings().deviceId; const i=cams.findIndex(c=>c.deviceId===cur); camDev=cams[(i+1)%cams.length].deviceId; startCamera(); return; }
  }catch{}
  camDev=null; facing=facing==="user"?"environment":"user"; startCamera();
};
$("endSetBtn").onclick=()=>finishSet();
$("videoFile").onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  await loadModel(); stopSource(); tracker.resetSmoothing(); tracker.setExercise(exKey);
  video.srcObject=null; video.src=URL.createObjectURL(f); video.classList.remove("mirror"); canvas.classList.remove("mirror");
  video.onended=()=>{finishSet();running=false;$("status").textContent="Video analyzed.";};
  await video.play(); $("overlay").hidden=true; $("bigrep").hidden=false; running=true; lastTs=-1; loop();
};
$("quality").value=modelKey;
$("quality").onchange=async()=>{
  modelKey=$("quality").value; try{localStorage.setItem("formiq.quality",modelKey)}catch{}
  const wasRunning=running; running=false;
  try{landmarker?.close();}catch{} landmarker=null; tracker.resetSmoothing();
  await loadModel(); if(wasRunning){running=true;lastTs=-1;loop();}
};
$("fileBtn").onclick=async()=>{ if(await ensureConsent()) $("videoFile").click(); };
$("targetReps").oninput=()=>renderLive();

/* keep the screen awake during a workout */
async function wake(){try{await navigator.wakeLock?.request("screen");}catch{}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&running)wake();});
video.addEventListener("playing",wake);

setLook(loadLook());   // read after the encrypted store is ready
paintGuideBtn(); paintAutoBtn(); renderLookUI(); renderEx(); renderLive(); renderSets(); renderHistory();
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

