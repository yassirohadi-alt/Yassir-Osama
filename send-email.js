const required=["BREVO_API_KEY","FIREBASE_CONFIG","FIREBASE_ROOM","EMAIL_TO","SENDER_EMAIL"];
for(const k of required){if(!process.env[k])throw new Error(`Missing GitHub Secret: ${k}`)}

function parseConfig(v){
  try{return JSON.parse(v)}
  catch{
    const c=v.replace(/^\s*(const|let|var)\s+\w+\s*=\s*/,"").replace(/;\s*$/,"");
    return Function(`"use strict";return (${c});`)();
  }
}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function pName(p,i){return p?.name||p?.title||p?.projectName||p?.nameEn||p?.project||`Project ${i+1}`}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function progress(p){
  for(const v of [p?.progress,p?.overallProgress,p?.completion,p?.percentage,p?.pct,p?.actualProgress]){
    const n=num(v); if(n!==null)return Math.max(0,Math.min(100,Math.round(n)));
  }
  if(Array.isArray(p?.phases)&&p.phases.length){
    const a=p.phases.map(x=>num(x?.progress??x?.percentage??x?.pct)).filter(x=>x!==null);
    if(a.length)return Math.round(a.reduce((x,y)=>x+y,0)/a.length);
  }
  return 0;
}
function status(p,pr){return String(p?.status||p?.projectStatus||p?.rag||p?.state||(pr>=100?"Completed":pr>0?"In Progress":"Not Started"))}
function color(s){
  s=s.toLowerCase();
  if(/complete|done|closed/.test(s))return "#2E7D5B";
  if(/delay|late|critical|risk|red/.test(s))return "#B0202E";
  if(/hold|pending|amber|warning/.test(s))return "#8A6A2C";
  return "#41618A";
}

async function main(){
  const cfg=parseConfig(process.env.FIREBASE_CONFIG);
  if(!cfg.databaseURL)throw new Error("FIREBASE_CONFIG does not contain databaseURL");

  const url=`${String(cfg.databaseURL).replace(/\/+$/,"")}/portals/${encodeURIComponent(process.env.FIREBASE_ROOM.trim())}.json`;
  const fr=await fetch(url);
  if(!fr.ok)throw new Error(`Firebase error ${fr.status}: ${await fr.text()}`);
  const store=await fr.json();
  if(!store)throw new Error("No data found in this Firebase room");

  const projects=Array.isArray(store.projects)?store.projects:Object.values(store.projects||{});
  if(!projects.length)throw new Error("No projects found in Firebase");

  const items=projects.map((p,i)=>{const pr=progress(p);return{name:pName(p,i),progress:pr,status:status(p,pr)}});
  const completed=items.filter(x=>x.progress>=100||/complete|done|closed/i.test(x.status)).length;
  const delayed=items.filter(x=>/delay|late|critical|risk|red/i.test(x.status)).length;
  const average=Math.round(items.reduce((s,x)=>s+x.progress,0)/items.length);

  const rows=items.map(x=>{
    const c=color(x.status);
    return `<tr>
      <td style="padding:11px;border-bottom:1px solid #E5E9F1;font-weight:600">${esc(x.name)}</td>
      <td style="padding:11px;border-bottom:1px solid #E5E9F1;text-align:center">
        <div style="height:8px;background:#EEF1F4;border-radius:20px;overflow:hidden"><div style="height:8px;width:${x.progress}%;background:#B12836"></div></div>
        <div style="margin-top:4px;font-weight:700">${x.progress}%</div>
      </td>
      <td style="padding:11px;border-bottom:1px solid #E5E9F1;text-align:center">
        <span style="display:inline-block;padding:5px 10px;border-radius:20px;background:${c}18;color:${c};font-weight:700">${esc(x.status)}</span>
      </td>
    </tr>`;
  }).join("");

  const now=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Baghdad",dateStyle:"full",timeStyle:"short"}).format(new Date());

  const html=`<!doctype html><html><body style="margin:0;background:#F4F6F9;font-family:Arial,sans-serif;color:#20242E">
  <div style="max-width:850px;margin:20px auto;background:#fff;border:1px solid #E5E9F1;border-radius:14px;overflow:hidden">
    <div style="padding:24px;background:#B12836;color:#fff"><h1 style="margin:0;font-size:22px">Knowledge Papers — Daily PMO Update</h1><div style="margin-top:7px;opacity:.85">${esc(now)}</div></div>
    <div style="padding:22px">
      <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px"><tr>
        <td style="background:#F4F6F9;padding:16px;text-align:center;border-radius:10px"><div style="font-size:26px;font-weight:800;color:#B12836">${items.length}</div><div style="font-size:12px;color:#6B7280">Total Projects</div></td>
        <td style="background:#F4F6F9;padding:16px;text-align:center;border-radius:10px"><div style="font-size:26px;font-weight:800;color:#2E7D5B">${completed}</div><div style="font-size:12px;color:#6B7280">Completed</div></td>
        <td style="background:#F4F6F9;padding:16px;text-align:center;border-radius:10px"><div style="font-size:26px;font-weight:800;color:#B0202E">${delayed}</div><div style="font-size:12px;color:#6B7280">Delayed / At Risk</div></td>
        <td style="background:#F4F6F9;padding:16px;text-align:center;border-radius:10px"><div style="font-size:26px;font-weight:800;color:#41618A">${average}%</div><div style="font-size:12px;color:#6B7280">Average Progress</div></td>
      </tr></table>
      <h2 style="font-size:17px;margin:20px 0 10px">Project Portfolio</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E9F1">
        <thead><tr style="background:#F4F6F9"><th style="padding:11px;text-align:left">Project</th><th style="padding:11px;text-align:center">Progress</th><th style="padding:11px;text-align:center">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#8A97A6">Generated automatically from Firebase Realtime Database.</p>
    </div>
  </div></body></html>`;

  const to=process.env.EMAIL_TO.split(/[;,]/).map(x=>x.trim()).filter(Boolean).map(email=>({email}));
  const br=await fetch("https://api.brevo.com/v3/smtp/email",{
    method:"POST",
    headers:{accept:"application/json","api-key":process.env.BREVO_API_KEY,"content-type":"application/json"},
    body:JSON.stringify({sender:{name:"Knowledge Papers PMO",email:process.env.SENDER_EMAIL},to,subject:`Daily PMO Dashboard Update — ${items.length} Projects`,htmlContent:html})
  });
  const result=await br.text();
  if(!br.ok)throw new Error(`Brevo error ${br.status}: ${result}`);
  console.log("Email sent successfully.");
  console.log(result);
}
main().catch(e=>{console.error(e);process.exit(1)});
