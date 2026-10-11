import fs from 'fs';
const mod = await import(process.argv[2] || '../../reps.js');
const model = process.argv[3] || 'full'; const step = +(process.argv[4]||1);
const cases = [
  ['pushup1','pushup',0.527,5],['pushup2','pushup',1.778,5],['pushup3','pushup',1.778,3],['pushups_long','pushup',1.778,76],
  ['squats1','squat',1.778,4],['side','squat',1.333,1],['oblique','squat',1.778,5],['curl','curl',1.778,19],
  ['walk','squat',1.778,0],['walk','pushup',1.778,0],['curl','squat',1.778,0],['curl','pushup',1.778,0],['squats2','squat',0.5625,4],['squats3','squat',1.778,5],
  // false-count checks: the wrong exercise selected, or no exercise at all
  ['squats1','pushup',1.778,0],['squats2','pushup',0.5625,0],['squats3','pushup',1.778,0],
  ['pushup2','squat',1.778,0],['pushups_long','squat',1.778,0],['pushup1','squat',0.527,0],
];
let err=0, tot=0, lines=[];
for (const [n,ex,asp,gt] of cases){
  const f=`./data/${n}_${model}.json`; if(!fs.existsSync(f)) continue;
  const d=JSON.parse(fs.readFileSync(f)); const tr=mod.createTracker(ex); let c=0; const at=[];
  for(let i=0;i<d.frames.length;i+=step){const fr=d.frames[i]; const r=tr.update(fr.lm||null,fr.w||null,fr.t,asp); if(r.rep){c++;at.push((fr.t/1000).toFixed(1));}}
  err+=Math.abs(c-gt); tot+=gt; lines.push(`${(n+' '+ex).padEnd(22)} want ${String(gt).padStart(2)} got ${String(c).padStart(2)} ${c===gt?'':'  <--'} ${process.env.V?at.join(' '):''}`);
}
console.log(`model=${model} step=${step}  total miscount=${err}`); console.log(lines.join('\n'));
