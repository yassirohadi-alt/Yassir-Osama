const admin = require("firebase-admin");
const { Resend } = require("resend");

// Firebase
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: firebaseConfig.projectId,
    clientEmail: firebaseConfig.clientEmail,
    privateKey: firebaseConfig.privateKey.replace(/\\n/g, "\n"),
  }),
  databaseURL: firebaseConfig.databaseURL,
});

const db = admin.database();

// Email
const resend = new Resend(process.env.BREVO_API_KEY);

async function sendDashboard() {

  // اقرأ آخر بيانات من Firebase
  const snap = await db.ref("/projects").once("value");
  const projects = snap.val() || {};

  const list = Object.values(projects);

  const total = list.length;
  const completed = list.filter(p => p.status === "Completed").length;
  const delayed = list.filter(p => p.status === "Delayed").length;

  let avg = 0;

  if(total>0){
      avg=Math.round(
        list.reduce((a,b)=>a+(Number(b.progress)||0),0)/total
      );
  }

  let rows="";

  list.forEach(p=>{

      rows += `
      <tr>
          <td>${p.name}</td>
          <td>${p.manager||"-"}</td>
          <td>${p.progress}%</td>
          <td>${p.status}</td>
          <td>${p.startDate||"-"}</td>
          <td>${p.endDate||"-"}</td>
      </tr>`;
  });

  const html = `
<h2>Knowledge Papers PMO Dashboard</h2>

<h3>Executive Summary</h3>

<ul>
<li>Total Projects : ${total}</li>
<li>Completed : ${completed}</li>
<li>Delayed : ${delayed}</li>
<li>Average Progress : ${avg}%</li>
</ul>

<table border="1" cellspacing="0" cellpadding="6">

<tr>
<th>Project</th>
<th>Manager</th>
<th>Progress</th>
<th>Status</th>
<th>Start</th>
<th>Finish</th>
</tr>

${rows}

</table>

<br>

<p>Generated Automatically from HTML Dashboard</p>

`;

await resend.emails.send({

from:"PMO Dashboard <dashboard@knowledgepapers.iq>",

to:process.env.EMAIL_TO,

subject:"Daily PMO Dashboard",

html

});

}
