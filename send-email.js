const required = [
  "BREVO_API_KEY",
  "FIREBASE_CONFIG",
  "FIREBASE_ROOM",
  "EMAIL_TO",
  "SENDER_EMAIL"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing GitHub Secret: ${key}`);
  }
}

function parseFirebaseConfig(value) {
  try {
    return JSON.parse(value);
  } catch {
    const cleaned = value
      .replace(/^\s*(const|let|var)\s+\w+\s*=\s*/, "")
      .replace(/;\s*$/, "");

    return Function(`"use strict"; return (${cleaned});`)();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberValue(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function getProjectName(project, index) {
  return (
    project?.nameEn ||
    project?.name ||
    project?.title ||
    project?.projectName ||
    `Project ${index + 1}`
  );
}

function getOwner(project) {
  return (
    project?.owner ||
    project?.projectManager ||
    project?.manager ||
    project?.pm ||
    project?.meta?.owner ||
    "—"
  );
}

function getProgress(project) {
  const values = [
    project?.progress,
    project?.overallProgress,
    project?.actualProgress,
    project?.completion,
    project?.percentage,
    project?.pct
  ];

  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return Math.max(0, Math.min(100, Math.round(number)));
    }
  }

  const phases = Array.isArray(project?.phases)
    ? project.phases
    : [];

  if (phases.length) {
    const phaseProgress = phases
      .map(phase =>
        Number(
          phase?.actualPct ??
          phase?.progress ??
          phase?.percentage ??
          phase?.pct
        )
      )
      .filter(Number.isFinite);

    if (phaseProgress.length) {
      return Math.round(
        phaseProgress.reduce((sum, value) => sum + value, 0) /
        phaseProgress.length
      );
    }
  }

  return 0;
}

function getPlan(project) {
  const values = [
    project?.planPct,
    project?.plannedProgress,
    project?.planProgress
  ];

  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return Math.max(0, Math.min(100, Math.round(number)));
    }
  }

  const phases = Array.isArray(project?.phases)
    ? project.phases
    : [];

  if (phases.length) {
    const plans = phases
      .map(phase => Number(phase?.planPct))
      .filter(Number.isFinite);

    if (plans.length) {
      return Math.round(
        plans.reduce((sum, value) => sum + value, 0) /
        plans.length
      );
    }
  }

  return 0;
}

function getStatus(actual, plan) {
  if (actual >= 100) {
    return {
      label: "Completed",
      color: "#1F8A4C"
    };
  }

  if (actual === 0 && plan === 0) {
    return {
      label: "Not Started",
      color: "#8A93A2"
    };
  }

  const variance = actual - plan;

  if (variance >= -5) {
    return {
      label: "On Track",
      color: "#1F8A4C"
    };
  }

  if (variance >= -20) {
    return {
      label: "At Risk",
      color: "#C08A2E"
    };
  }

  return {
    label: "Critical",
    color: "#B0202E"
  };
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function getFinishDate(project) {
  if (project?.endDate || project?.finishDate) {
    return project.endDate || project.finishDate;
  }

  const milestones = Array.isArray(project?.milestones)
    ? project.milestones
    : [];

  const dates = milestones
    .map(milestone =>
      milestone?.planEnd ||
      milestone?.endDate ||
      milestone?.dueDate
    )
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(date => !Number.isNaN(date.getTime()));

  if (!dates.length) return "";

  return new Date(
    Math.max(...dates.map(date => date.getTime()))
  ).toISOString();
}

async function main() {
  const firebaseConfig = parseFirebaseConfig(
    process.env.FIREBASE_CONFIG
  );

  if (!firebaseConfig.databaseURL) {
    throw new Error(
      "FIREBASE_CONFIG does not contain databaseURL"
    );
  }

  const databaseURL = String(
    firebaseConfig.databaseURL
  ).replace(/\/+$/, "");

  const room = encodeURIComponent(
    process.env.FIREBASE_ROOM.trim()
  );

  // يقرأ آخر تحديث من نفس غرفة الداشبورد
  const firebaseURL =
    `${databaseURL}/portals/${room}.json`;

  console.log(
    `Reading latest Firebase data from room: ${process.env.FIREBASE_ROOM}`
  );

  const firebaseResponse = await fetch(firebaseURL);

  if (!firebaseResponse.ok) {
    throw new Error(
      `Firebase error ${firebaseResponse.status}: ` +
      await firebaseResponse.text()
    );
  }

  const store = await firebaseResponse.json();

  if (!store) {
    throw new Error(
      "No data found inside the selected Firebase room"
    );
  }

  const rawProjects = Array.isArray(store.projects)
    ? store.projects
    : Object.values(store.projects || {});

  const projects = rawProjects.filter(Boolean);

  if (!projects.length) {
    throw new Error(
      "Firebase connected, but no projects were found"
    );
  }

  const report = projects.map((project, index) => {
    const actual = getProgress(project);
    const plan = getPlan(project);
    const variance = actual - plan;
    const status = getStatus(actual, plan);

    const milestones = Array.isArray(project?.milestones)
      ? project.milestones
      : [];

    const risks = Array.isArray(project?.risks)
      ? project.risks
      : [];

    const completedMilestones = milestones.filter(
      milestone =>
        milestone?.status === "d" ||
        String(milestone?.status).toLowerCase() ===
          "completed"
    ).length;

    const openRisks = risks.filter(
      risk =>
        !risk?.status ||
        String(risk.status).toLowerCase() === "open"
    ).length;

    return {
      name: getProjectName(project, index),
      owner: getOwner(project),
      actual,
      plan,
      variance,
      status,
      totalMilestones: milestones.length,
      completedMilestones,
      openRisks,
      finish: getFinishDate(project)
    };
  });

  const totalProjects = report.length;

  const completed = report.filter(
    project => project.actual >= 100
  ).length;

  const onTrack = report.filter(
    project => project.status.label === "On Track"
  ).length;

  const atRisk = report.filter(
    project => project.status.label === "At Risk"
  ).length;

  const critical = report.filter(
    project => project.status.label === "Critical"
  ).length;

  const averageProgress = Math.round(
    report.reduce(
      (sum, project) => sum + project.actual,
      0
    ) / totalProjects
  );

  const averagePlan = Math.round(
    report.reduce(
      (sum, project) => sum + project.plan,
      0
    ) / totalProjects
  );

  const portfolioSPI =
    averagePlan > 0
      ? averageProgress / averagePlan
      : 1;

  const totalRisks = report.reduce(
    (sum, project) => sum + project.openRisks,
    0
  );

  const totalMilestones = report.reduce(
    (sum, project) =>
      sum + project.totalMilestones,
    0
  );

  const completedMilestones = report.reduce(
    (sum, project) =>
      sum + project.completedMilestones,
    0
  );

  const attentionProjects = report
    .filter(project =>
      project.status.label === "Critical" ||
      project.status.label === "At Risk"
    )
    .sort((a, b) => a.variance - b.variance)
    .slice(0, 5);

  const projectRows = report.map(project => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #E5E9F1;font-weight:700;">
        ${escapeHtml(project.name)}
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;">
        ${escapeHtml(project.owner)}
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        <div style="height:8px;background:#EDF0F4;border-radius:20px;overflow:hidden;">
          <div style="height:8px;width:${project.actual}%;background:#B12836;"></div>
        </div>

        <div style="margin-top:4px;font-weight:700;">
          ${project.actual}%
        </div>
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        ${project.plan}%
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;color:${project.variance < 0 ? "#B0202E" : "#1F8A4C"};font-weight:700;">
        ${project.variance > 0 ? "+" : ""}
        ${project.variance}%
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        <span style="display:inline-block;padding:5px 9px;border-radius:20px;background:${project.status.color}18;color:${project.status.color};font-weight:700;">
          ${project.status.label}
        </span>
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        ${project.completedMilestones}/${project.totalMilestones}
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        ${project.openRisks}
      </td>

      <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
        ${formatDate(project.finish)}
      </td>
    </tr>
  `).join("");

  const attentionRows = attentionProjects.length
    ? attentionProjects.map(project => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #F0D7DA;font-weight:700;">
          ${escapeHtml(project.name)}
        </td>

        <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
          ${project.actual}%
        </td>

        <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
          ${project.plan}%
        </td>

        <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;color:#B0202E;font-weight:700;">
          ${project.variance}%
        </td>

        <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
          ${project.openRisks}
        </td>

        <td style="padding:10px;border-bottom:1px solid #F0D7DA;">
          ${escapeHtml(project.owner)}
        </td>
      </tr>
    `).join("")
    : `
      <tr>
        <td colspan="6" style="padding:16px;text-align:center;color:#1F8A4C;">
          No projects require executive attention.
        </td>
      </tr>
    `;

  const baghdadDate = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Baghdad",
      dateStyle: "full",
      timeStyle: "short"
    }
  ).format(new Date());

  const html = `
  <!DOCTYPE html>

  <html>
    <body style="margin:0;background:#EEF1F5;font-family:Arial,sans-serif;color:#20242E;">

      <div style="max-width:1050px;margin:18px auto;background:#FFFFFF;border:1px solid #DDE2E9;border-radius:14px;overflow:hidden;">

        <div style="padding:25px;background:#B12836;color:#FFFFFF;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;">
            KNOWLEDGE PAPERS
          </div>

          <div style="font-size:25px;font-weight:800;margin-top:5px;">
            Daily PMO Executive Dashboard
          </div>

          <div style="margin-top:7px;font-size:12px;opacity:.9;">
            ${escapeHtml(baghdadDate)} · Latest Firebase Update
          </div>
        </div>

        <div style="padding:22px;">

          <table style="width:100%;border-collapse:separate;border-spacing:7px;">
            <tr>
              <td style="background:#F6F8FB;padding:16px;text-align:center;border-radius:10px;">
                <div style="font-size:26px;font-weight:800;color:#B12836;">
                  ${totalProjects}
                </div>
                <div style="font-size:12px;font-weight:700;">
                  Total Projects
                </div>
              </td>

              <td style="background:#F6F8FB;padding:16px;text-align:center;border-radius:10px;">
                <div style="font-size:26px;font-weight:800;color:#41618A;">
                  ${averageProgress}%
                </div>
                <div style="font-size:12px;font-weight:700;">
                  Portfolio Progress
                </div>
              </td>

              <td style="background:#F6F8FB;padding:16px;text-align:center;border-radius:10px;">
                <div style="font-size:26px;font-weight:800;color:${portfolioSPI >= .95 ? "#1F8A4C" : "#B0202E"};">
                  ${portfolioSPI.toFixed(2)}
                </div>
                <div style="font-size:12px;font-weight:700;">
                  Portfolio SPI
                </div>
              </td>

              <td style="background:#F6F8FB;padding:16px;text-align:center;border-radius:10px;">
                <div style="font-size:26px;font-weight:800;color:#B0202E;">
                  ${totalRisks}
                </div>
                <div style="font-size:12px;font-weight:700;">
                  Open Risks
                </div>
              </td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:separate;border-spacing:7px;">
            <tr>
              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#1F8A4C;">${completed}</b>
                <div style="font-size:11px;">Completed</div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#1F8A4C;">${onTrack}</b>
                <div style="font-size:11px;">On Track</div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#C08A2E;">${atRisk}</b>
                <div style="font-size:11px;">At Risk</div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#B0202E;">${critical}</b>
                <div style="font-size:11px;">Critical</div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#41618A;">
                  ${completedMilestones}/${totalMilestones}
                </b>
                <div style="font-size:11px;">Milestones</div>
              </td>
            </tr>
          </table>

          <h2 style="font-size:17px;color:#8A1E2A;margin-top:24px;">
            Executive Attention
          </h2>

          <table style="width:100%;border-collapse:collapse;border:1px solid #F0D7DA;font-size:12px;">
            <thead>
              <tr style="background:#FBEFF1;">
                <th style="padding:10px;text-align:left;">Project</th>
                <th style="padding:10px;">Actual</th>
                <th style="padding:10px;">Plan</th>
                <th style="padding:10px;">Variance</th>
                <th style="padding:10px;">Risks</th>
                <th style="padding:10px;text-align:left;">Owner</th>
              </tr>
            </thead>

            <tbody>
              ${attentionRows}
            </tbody>
          </table>

          <h2 style="font-size:17px;color:#8A1E2A;margin-top:24px;">
            Full Project Portfolio
          </h2>

          <table style="width:100%;border-collapse:collapse;border:1px solid #E5E9F1;font-size:11px;">
            <thead>
              <tr style="background:#F3F5F8;">
                <th style="padding:10px;text-align:left;">Project</th>
                <th style="padding:10px;text-align:left;">Owner</th>
                <th style="padding:10px;">Actual</th>
                <th style="padding:10px;">Plan</th>
                <th style="padding:10px;">Variance</th>
                <th style="padding:10px;">Status</th>
                <th style="padding:10px;">Milestones</th>
                <th style="padding:10px;">Risks</th>
                <th style="padding:10px;">Finish</th>
              </tr>
            </thead>

            <tbody>
              ${projectRows}
            </tbody>
          </table>

          <div style="margin-top:20px;padding-top:13px;border-top:1px solid #E5E9F1;font-size:11px;color:#7B8493;">
            This report reads the latest data directly from Firebase Realtime Database when the workflow runs.
          </div>

        </div>
      </div>

    </body>
  </html>
  `;

  const recipients = process.env.EMAIL_TO
    .split(/[;,]/)
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => ({ email }));

  if (!recipients.length) {
    throw new Error(
      "EMAIL_TO contains no valid email addresses"
    );
  }

  const brevoResponse = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",

      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json"
      },

      body: JSON.stringify({
        sender: {
          name: "Knowledge Papers PMO",
          email: process.env.SENDER_EMAIL
        },

        to: recipients,

        subject:
          `PMO Executive Update — ${totalProjects} Projects · ${averageProgress}% Progress`,

        htmlContent: html
      })
    }
  );

  const brevoResult = await brevoResponse.text();

  if (!brevoResponse.ok) {
    throw new Error(
      `Brevo error ${brevoResponse.status}: ${brevoResult}`
    );
  }

  console.log("Executive PMO email sent successfully.");
  console.log(brevoResult);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
