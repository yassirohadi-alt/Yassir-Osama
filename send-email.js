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

function parseConfig(value) {
  try {
    return JSON.parse(value);
  } catch {
    const cleaned = value
      .replace(/^\s*(const|let|var)\s+\w+\s*=\s*/, "")
      .replace(/;\s*$/, "");

    return Function(
      `"use strict"; return (${cleaned});`
    )();
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function n(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function fmtMoney(value) {
  const amount = n(value);

  if (Math.abs(amount) >= 1e9) {
    return `${(amount / 1e9).toFixed(2)}B`;
  }

  if (Math.abs(amount) >= 1e6) {
    return `${(amount / 1e6).toFixed(2)}M`;
  }

  if (Math.abs(amount) >= 1e3) {
    return `${(amount / 1e3).toFixed(1)}K`;
  }

  return Math.round(amount).toLocaleString("en-US");
}

function dateText(value) {
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

function flattenProjects(projects) {
  const result = [];

  for (const project of projects || []) {
    if (
      Array.isArray(project?.subProjects) &&
      project.subProjects.length
    ) {
      result.push(
        ...flattenProjects(project.subProjects)
      );
    } else if (project) {
      result.push(project);
    }
  }

  return result;
}

const SO_STEP_KEYS = [
  "corr",
  "resp",
  "visit1",
  "land",
  "design",
  "appOffice",
  "appBenef",
  "demarc",
  "workStart",
  "workEnd"
];

const FLOOR_ITEM_KEYS = [
  "cabinet",
  "power",
  "access",
  "tray",
  "fiber",
  "cabPower",
  "rack",
  "testing"
];

function statusWeight(status) {
  if (status === "d") return 1;
  if (status === "p") return 0.5;
  return 0;
}

function serviceOfficePct(office) {
  if (!office?.steps) return 0;

  const score = SO_STEP_KEYS.reduce(
    (sum, key) =>
      sum + statusWeight(
        office.steps[key] || "n"
      ),
    0
  );

  return Math.round(
    score / SO_STEP_KEYS.length * 100
  );
}

function dataCenterPct(project) {
  const items = project?.items || [];

  if (!items.length) return 0;

  const score = items.reduce(
    (sum, item) =>
      sum + statusWeight(item?.status || "n"),
    0
  );

  return Math.round(
    score / items.length * 100
  );
}

function hasFloorModel(project) {
  return Boolean(project) && (
    project.floorModel === true ||
    project.id === "p5" ||
    /الشبكات والبنى|network\s*&?\s*infra/i.test(
      `${project.nameEn || ""} ${project.name || ""}`
    )
  );
}

function floorPct(floor) {
  const items = floor?.items || {};

  const score = FLOOR_ITEM_KEYS.reduce(
    (sum, key) =>
      sum + statusWeight(items[key] || "n"),
    0
  );

  return Math.round(
    score / FLOOR_ITEM_KEYS.length * 100
  );
}

function siteFloorPct(site) {
  const floors = site?.floors || [];

  if (!floors.length) return 0;

  return Math.round(
    floors.reduce(
      (sum, floor) => sum + floorPct(floor),
      0
    ) / floors.length
  );
}

function siteDesignPct(site) {
  if (!site) return 0;

  const completedSteps =
    (site.survey === "d" ? 1 : 0) +
    (site.design === "d" ? 1 : 0) +
    (site.submit === "d" ? 1 : 0);

  return Math.round(
    completedSteps / 3 * 100
  );
}

function siteFinalPct(site) {
  if (!site) return 0;

  return Math.round(
    (
      siteDesignPct(site) +
      siteFloorPct(site)
    ) / 2
  );
}
function overallPct(project) {
  if (
    Array.isArray(project?.subProjects) &&
    project.subProjects.length
  ) {
    return Math.round(
      project.subProjects.reduce(
        (sum, subProject) =>
          sum + overallPct(subProject),
        0
      ) / project.subProjects.length
    );
  }

  if (project?.meta?.trainingModel === true) {
    return Math.max(
      0,
      Math.min(100, Math.round(n(project.progress)))
    );
  }

  if (project?.meta?.serviceOfficeModel === true) {
    const offices = (project.sites || [])
      .filter(Boolean);

    if (offices.length) {
      return Math.round(
        offices.reduce(
          (sum, office) =>
            sum + serviceOfficePct(office),
          0
        ) / offices.length
      );
    }
  }

  if (project?.meta?.dcModel === true) {
    return dataCenterPct(project);
  }

  if (project?.meta?.paymentModel === true) {
    const payments = project.payments || [];

    if (!payments.length) return 0;

    const completedPayments = payments.filter(
      payment =>
        String(payment?.status).toLowerCase() ===
        "done"
    ).length;

    return Math.round(
      completedPayments / payments.length * 100
    );
  }

  if (project?.meta?.surveyModel === true) {
    const surveyRows = project.survey || [];

    if (!surveyRows.length) return 0;

    let assigned = 0;
    let completed = 0;

    for (const row of surveyRows) {
      const assignedNumber = n(row?.assignees);

      assigned += assignedNumber;
      completed += Math.min(
        n(row?.daily),
        assignedNumber
      );
    }

    return assigned > 0
      ? Math.round(completed / assigned * 100)
      : 0;
  }

  if (project?.meta?.progressSource === "phases") {
    const phases = project.phases || [];

    if (phases.length) {
      return Math.round(
        phases.reduce(
          (sum, phase) =>
            sum +
            n(
              phase?.actualPct ??
              phase?.progress ??
              phase?.pct
            ),
          0
        ) / phases.length
      );
    }
  }

  const sites = (project?.sites || [])
    .filter(Boolean);

  if (sites.length) {
    if (hasFloorModel(project)) {
      return Math.round(
        sites.reduce(
          (sum, site) =>
            sum + siteFinalPct(site),
          0
        ) / sites.length
      );
    }

    return Math.round(
      sites.reduce(
        (sum, site) =>
          sum + siteDesignPct(site),
        0
      ) / sites.length
    );
  }

  const phases = project?.phases || [];

  if (phases.length) {
    return Math.round(
      phases.reduce(
        (sum, phase) =>
          sum +
          n(
            phase?.actualPct ??
            phase?.progress ??
            phase?.pct
          ),
        0
      ) / phases.length
    );
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        n(
          project?.progress ??
          project?.overallProgress ??
          project?.actualProgress ??
          project?.completion ??
          project?.percentage ??
          project?.pct
        )
      )
    )
  );
}

function planPct(project) {
  const directValues = [
    project?.planPct,
    project?.plannedProgress,
    project?.planProgress
  ];

  for (const value of directValues) {
    const result = Number(value);

    if (Number.isFinite(result)) {
      return Math.max(
        0,
        Math.min(100, Math.round(result))
      );
    }
  }

  const phases = project?.phases || [];

  if (phases.length) {
    const phasePlans = phases
      .map(phase =>
        Number(
          phase?.planPct ??
          phase?.plannedProgress
        )
      )
      .filter(Number.isFinite);

    if (phasePlans.length) {
      return Math.round(
        phasePlans.reduce(
          (sum, value) => sum + value,
          0
        ) / phasePlans.length
      );
    }
  }

  return 0;
}

function projectName(project, index = 0) {
  return (
    project?.nameEn ||
    project?.name ||
    project?.title ||
    project?.projectName ||
    `Project ${index + 1}`
  );
}

function projectOwner(project) {
  return (
    project?.owner ||
    project?.projectManager ||
    project?.manager ||
    project?.pm ||
    project?.meta?.owner ||
    "—"
  );
}

function ragFor(actual, plan) {
  if (actual >= 100) return "completed";

  if (actual === 0 && plan === 0) {
    return "not-started";
  }

  const variance = actual - plan;

  if (variance >= -5) return "on-track";
  if (variance >= -20) return "at-risk";

  return "critical";
}

function ragLabel(status) {
  const labels = {
    completed: "Completed",
    "not-started": "Not Started",
    "on-track": "On Track",
    "at-risk": "At Risk",
    critical: "Critical"
  };

  return labels[status] || "Unknown";
}

function ragColor(status) {
  const colors = {
    completed: "#1F8A4C",
    "not-started": "#8A93A2",
    "on-track": "#1F8A4C",
    "at-risk": "#C08A2E",
    critical: "#B0202E"
  };

  return colors[status] || "#8A93A2";
}

function statusName(status) {
  const names = {
    d: "Done",
    p: "In Progress",
    n: "Not Started",
    h: "On Hold",
    done: "Done",
    completed: "Completed",
    pending: "Pending",
    delayed: "Delayed",
    open: "Open",
    closed: "Closed"
  };

  const normalized = String(
    status || ""
  ).toLowerCase();

  return names[normalized] || status || "—";
}

function impactLabel(value) {
  const labels = {
    1: "Low",
    2: "Medium",
    3: "High",
    low: "Low",
    medium: "Medium",
    high: "High"
  };

  const normalized =
    typeof value === "string"
      ? value.toLowerCase()
      : value;

  return labels[normalized] || value || "—";
}

function finishDate(project) {
  if (project?.endDate || project?.finishDate) {
    return project.endDate || project.finishDate;
  }

  const milestones = project?.milestones || [];

  const dates = milestones
    .map(milestone =>
      milestone?.planEnd ||
      milestone?.endDate ||
      milestone?.dueDate
    )
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(
      date => !Number.isNaN(date.getTime())
    );

  if (!dates.length) return "";

  return new Date(
    Math.max(
      ...dates.map(date => date.getTime())
    )
  ).toISOString();
}

function isCompletedMilestone(milestone) {
  const status = String(
    milestone?.status || ""
  ).toLowerCase();

  return (
    status === "d" ||
    status === "done" ||
    status === "completed"
  );
}

function isOpenRisk(risk) {
  const status = String(
    risk?.status || "open"
  ).toLowerCase();

  return ![
    "closed",
    "resolved",
    "done",
    "completed"
  ].includes(status);
}
function detailTable(title, headers, rows) {
  if (!rows.length) return "";

  return `
    <div style="margin-top:16px;font-size:14px;font-weight:800;color:#8A1E2A;">
      ${esc(title)}
    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:7px;border:1px solid #E5E9F1;font-size:11px;">
      <thead>
        <tr style="background:#F3F5F8;">
          ${headers.map(header => `
            <th style="padding:8px;text-align:left;border-bottom:1px solid #DDE2E9;">
              ${esc(header)}
            </th>
          `).join("")}
        </tr>
      </thead>

      <tbody>
        ${rows.map(row => `
          <tr>
            ${row.map(cell => `
              <td style="padding:8px;border-bottom:1px solid #E5E9F1;vertical-align:top;">
                ${esc(cell)}
              </td>
            `).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function projectDetailBlock(project, index) {
  const name = projectName(project, index);
  const actual = overallPct(project);
  const plan = planPct(project);
  const variance = actual - plan;
  const rag = ragFor(actual, plan);
  const color = ragColor(rag);

  const phases = (project.phases || []).map(
    phase => [
      phase?.name ||
        phase?.nameEn ||
        phase?.nameAr ||
        "Phase",

      `${Math.round(
        n(
          phase?.planPct ??
          phase?.plannedProgress
        )
      )}%`,

      `${Math.round(
        n(
          phase?.actualPct ??
          phase?.progress ??
          phase?.pct
        )
      )}%`,

      statusName(phase?.status),

      dateText(
        phase?.planStart ||
        phase?.startDate
      ),

      dateText(
        phase?.planEnd ||
        phase?.endDate
      )
    ]
  );

  const milestones = (
    project.milestones || []
  ).map(milestone => [
    milestone?.name ||
      milestone?.nameEn ||
      milestone?.nameAr ||
      milestone?.title ||
      "Milestone",

    statusName(milestone?.status),

    `${Math.round(n(milestone?.planPct))}%`,

    `${Math.round(
      n(
        milestone?.actualPct ??
        milestone?.progress
      )
    )}%`,

    milestone?.owner ||
      projectOwner(project),

    dateText(
      milestone?.planStart ||
      milestone?.startDate
    ),

    dateText(
      milestone?.planEnd ||
      milestone?.endDate ||
      milestone?.dueDate
    ),

    milestone?.notes || "—"
  ]);

  const risks = (project.risks || []).map(
    risk => [
      risk?.risk ||
        risk?.title ||
        risk?.description ||
        "Risk",

      impactLabel(risk?.impact),

      impactLabel(
        risk?.probability ??
        risk?.prob
      ),

      statusName(risk?.status || "open"),

      risk?.owner || "—",

      risk?.mitigation ||
        risk?.response ||
        "—"
    ]
  );

  const team = (project.team || []).map(
    member => [
      member?.name ||
        member?.resource ||
        "Team Member",

      String(
        n(
          member?.tasks?.done ??
          member?.done
        )
      ),

      String(
        n(
          member?.tasks?.prog ??
          member?.tasks?.inProgress ??
          member?.inProgress
        )
      ),

      String(
        n(
          member?.tasks?.pend ??
          member?.tasks?.pending ??
          member?.pending
        )
      )
    ]
  );

  const qaRows = (project.qa || []).map(
    item => [
      item?.item ||
        item?.name ||
        item?.title ||
        "QA Item",

      item?.standard ||
        item?.criteria ||
        "—",

      statusName(item?.status),

      item?.notes || "—"
    ]
  );

  const budgetRows = (
    project.budget || []
  ).map(item => {
    const planned = n(
      item?.planned ??
      item?.budget ??
      item?.plan
    );

    const actualCost = n(
      item?.actual ??
      item?.spent ??
      item?.cost
    );

    return [
      item?.item ||
        item?.name ||
        item?.category ||
        "Budget Item",

      fmtMoney(planned),

      fmtMoney(actualCost),

      fmtMoney(planned - actualCost),

      item?.notes || "—"
    ];
  });

  const sites = (
    project.sites || []
  )
    .filter(Boolean)
    .map(site => {
      const progress = hasFloorModel(project)
        ? siteFinalPct(site)
        : siteDesignPct(site);

      return [
        site?.name ||
          site?.site ||
          site?.office ||
          "Site",

        statusName(site?.survey),

        statusName(site?.design),

        statusName(site?.submit),

        `${progress}%`,

        site?.region ||
          site?.city ||
          site?.location ||
          "—",

        site?.contractor ||
          site?.vendor ||
          "—",

        site?.notes || "—"
      ];
    });

  const dataCenterItems = (
    project.items || []
  ).map(item => [
    item?.group ||
      item?.category ||
      "General",

    item?.name ||
      item?.item ||
      "Item",

    statusName(item?.status),

    dateText(
      item?.start ||
      item?.startDate
    ),

    dateText(
      item?.end ||
      item?.endDate
    ),

    item?.notes || "—"
  ]);

  const payments = (
    project.payments || []
  ).map(payment => [
    payment?.name ||
      payment?.item ||
      payment?.title ||
      "Payment",

    statusName(payment?.status),

    fmtMoney(payment?.amount),

    dateText(
      payment?.date ||
      payment?.dueDate
    ),

    payment?.notes || "—"
  ]);

  const surveyRows = (
    project.survey || []
  ).map(row => {
    const assigned = n(row?.assignees);
    const completed = Math.min(
      n(row?.daily),
      assigned
    );

    const progress = assigned > 0
      ? Math.round(
          completed / assigned * 100
        )
      : 0;

    return [
      row?.name ||
        row?.site ||
        row?.department ||
        "Survey Item",

      String(assigned),

      String(completed),

      `${progress}%`,

      row?.notes || "—"
    ];
  });

  return `
    <div style="margin-top:22px;border:1px solid #DDE2E9;border-radius:12px;overflow:hidden;">

      <div style="background:#FAFBFC;padding:15px 17px;border-bottom:1px solid #DDE2E9;">

        <div style="font-size:16px;font-weight:800;color:#20242E;">
          ${esc(name)}
        </div>

        <div style="margin-top:8px;font-size:12px;color:#5B6572;line-height:1.7;">

          Owner:
          <b>${esc(projectOwner(project))}</b>

          &nbsp;·&nbsp; Actual:
          <b>${actual}%</b>

          &nbsp;·&nbsp; Plan:
          <b>${plan}%</b>

          &nbsp;·&nbsp; Variance:
          <b style="color:${variance < 0 ? "#B0202E" : "#1F8A4C"};">
            ${variance > 0 ? "+" : ""}${variance}%
          </b>

          &nbsp;·&nbsp;

          <span style="color:${color};font-weight:800;">
            ${ragLabel(rag)}
          </span>

        </div>

        <div style="margin-top:10px;height:9px;background:#EDF0F4;border-radius:20px;overflow:hidden;">
          <div style="width:${Math.max(0, Math.min(100, actual))}%;height:9px;background:${color};"></div>
        </div>

      </div>

      <div style="padding:14px 16px;">

        ${detailTable(
          "Phases",
          [
            "Phase",
            "Plan",
            "Actual",
            "Status",
            "Start",
            "Finish"
          ],
          phases
        )}

        ${detailTable(
          "Milestones",
          [
            "Milestone",
            "Status",
            "Plan",
            "Actual",
            "Owner",
            "Start",
            "Finish",
            "Notes"
          ],
          milestones
        )}

        ${detailTable(
          "Sites / Offices",
          [
            "Site",
            "Survey",
            "Design",
            "Submit",
            "Progress",
            "Region",
            "Contractor",
            "Notes"
          ],
          sites
        )}

        ${detailTable(
          "Data Center Items",
          [
            "Group",
            "Item",
            "Status",
            "Start",
            "Finish",
            "Notes"
          ],
          dataCenterItems
        )}

        ${detailTable(
          "Payments",
          [
            "Payment",
            "Status",
            "Amount",
            "Due Date",
            "Notes"
          ],
          payments
        )}

        ${detailTable(
          "Survey Progress",
          [
            "Item",
            "Assigned",
            "Completed",
            "Progress",
            "Notes"
          ],
          surveyRows
        )}

        ${detailTable(
          "Risks",
          [
            "Risk",
            "Impact",
            "Probability",
            "Status",
            "Owner",
            "Mitigation"
          ],
          risks
        )}

        ${detailTable(
          "QA / Checklist",
          [
            "Item",
            "Standard",
            "Status",
            "Notes"
          ],
          qaRows
        )}

        ${detailTable(
          "Team Workload",
          [
            "Resource",
            "Done",
            "In Progress",
            "Pending"
          ],
          team
        )}

        ${detailTable(
          "Budget Details",
          [
            "Item",
            "Planned",
            "Actual",
            "Variance",
            "Notes"
          ],
          budgetRows
        )}

      </div>
    </div>
  `;
}
async function main() {
  const firebaseConfig = parseConfig(
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

  const firebaseURL =
    `${databaseURL}/portals/${room}.json`;

  console.log(
    `Reading latest Firebase data from room: ${process.env.FIREBASE_ROOM}`
  );

  const firebaseResponse = await fetch(
    firebaseURL
  );

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

  const rawProjects = Array.isArray(
    store.projects
  )
    ? store.projects
    : Object.values(store.projects || {});

  const projects = flattenProjects(
    rawProjects.filter(Boolean)
  );

  if (!projects.length) {
    throw new Error(
      "Firebase connected, but no projects were found"
    );
  }

  const report = projects.map(
    (project, index) => {
      const actual = overallPct(project);
      const plan = planPct(project);
      const variance = actual - plan;
      const rag = ragFor(actual, plan);

      const milestones =
        project?.milestones || [];

      const risks =
        project?.risks || [];

      const completedMilestones =
        milestones.filter(
          isCompletedMilestone
        ).length;

      const openRisks =
        risks.filter(
          isOpenRisk
        ).length;

      return {
        project,
        index,
        name: projectName(
          project,
          index
        ),
        owner: projectOwner(project),
        actual,
        plan,
        variance,
        rag,
        statusLabel: ragLabel(rag),
        statusColor: ragColor(rag),
        totalMilestones:
          milestones.length,
        completedMilestones,
        openRisks,
        finish: finishDate(project)
      };
    }
  );

  const totalProjects = report.length;

  const completed = report.filter(
    item => item.actual >= 100
  ).length;

  const onTrack = report.filter(
    item =>
      item.rag === "on-track"
  ).length;

  const atRisk = report.filter(
    item =>
      item.rag === "at-risk"
  ).length;

  const critical = report.filter(
    item =>
      item.rag === "critical"
  ).length;

  const averageProgress = Math.round(
    report.reduce(
      (sum, item) =>
        sum + item.actual,
      0
    ) / totalProjects
  );

  const averagePlan = Math.round(
    report.reduce(
      (sum, item) =>
        sum + item.plan,
      0
    ) / totalProjects
  );

  const portfolioSPI =
    averagePlan > 0
      ? averageProgress / averagePlan
      : 1;

  const totalRisks = report.reduce(
    (sum, item) =>
      sum + item.openRisks,
    0
  );

  const totalMilestones =
    report.reduce(
      (sum, item) =>
        sum + item.totalMilestones,
      0
    );

  const completedMilestones =
    report.reduce(
      (sum, item) =>
        sum +
        item.completedMilestones,
      0
    );

  const attentionProjects = report
    .filter(
      item =>
        item.rag === "critical" ||
        item.rag === "at-risk"
    )
    .sort(
      (a, b) =>
        a.variance - b.variance
    )
    .slice(0, 5);

  const projectRows = report
    .map(item => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #E5E9F1;font-weight:700;">
          ${esc(item.name)}
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;">
          ${esc(item.owner)}
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          <div style="height:8px;background:#EDF0F4;border-radius:20px;overflow:hidden;">
            <div style="height:8px;width:${item.actual}%;background:${item.statusColor};"></div>
          </div>

          <div style="margin-top:4px;font-weight:700;">
            ${item.actual}%
          </div>
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          ${item.plan}%
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;color:${item.variance < 0 ? "#B0202E" : "#1F8A4C"};font-weight:700;">
          ${item.variance > 0 ? "+" : ""}
          ${item.variance}%
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          <span style="display:inline-block;padding:5px 9px;border-radius:20px;background:${item.statusColor}18;color:${item.statusColor};font-weight:700;">
            ${item.statusLabel}
          </span>
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          ${item.completedMilestones}/${item.totalMilestones}
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          ${item.openRisks}
        </td>

        <td style="padding:10px;border-bottom:1px solid #E5E9F1;text-align:center;">
          ${dateText(item.finish)}
        </td>
      </tr>
    `)
    .join("");

  const attentionRows =
    attentionProjects.length
      ? attentionProjects
          .map(item => `
            <tr>
              <td style="padding:10px;border-bottom:1px solid #F0D7DA;font-weight:700;">
                ${esc(item.name)}
              </td>

              <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
                ${item.actual}%
              </td>

              <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
                ${item.plan}%
              </td>

              <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;color:#B0202E;font-weight:700;">
                ${item.variance > 0 ? "+" : ""}
                ${item.variance}%
              </td>

              <td style="padding:10px;border-bottom:1px solid #F0D7DA;text-align:center;">
                ${item.openRisks}
              </td>

              <td style="padding:10px;border-bottom:1px solid #F0D7DA;">
                ${esc(item.owner)}
              </td>
            </tr>
          `)
          .join("")
      : `
          <tr>
            <td colspan="6" style="padding:16px;text-align:center;color:#1F8A4C;">
              No projects require executive attention.
            </td>
          </tr>
        `;

  const detailedProjectBlocks =
    projects
      .map(
        (project, index) =>
          projectDetailBlock(
            project,
            index
          )
      )
      .join("");

  const baghdadDate =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Asia/Baghdad",
        dateStyle:
          "full",
        timeStyle:
          "short"
      }
    ).format(new Date());
  const html = `
  <!DOCTYPE html>
  <html>
    <body style="margin:0;background:#EEF1F5;font-family:Arial,sans-serif;color:#20242E;">

      <div style="max-width:1100px;margin:18px auto;background:#FFFFFF;border:1px solid #DDE2E9;border-radius:14px;overflow:hidden;">

        <div style="padding:25px;background:#B12836;color:#FFFFFF;">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;">
            KNOWLEDGE PAPERS
          </div>

          <div style="font-size:25px;font-weight:800;margin-top:5px;">
            Daily PMO Executive Dashboard — Detailed
          </div>

          <div style="margin-top:7px;font-size:12px;opacity:.9;">
            ${esc(baghdadDate)} · Latest Firebase Update
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
                <div style="font-size:26px;font-weight:800;color:${portfolioSPI >= 0.95 ? "#1F8A4C" : "#B0202E"};">
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
                <b style="font-size:22px;color:#1F8A4C;">
                  ${completed}
                </b>
                <div style="font-size:11px;">
                  Completed
                </div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#1F8A4C;">
                  ${onTrack}
                </b>
                <div style="font-size:11px;">
                  On Track
                </div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#C08A2E;">
                  ${atRisk}
                </b>
                <div style="font-size:11px;">
                  At Risk
                </div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#B0202E;">
                  ${critical}
                </b>
                <div style="font-size:11px;">
                  Critical
                </div>
              </td>

              <td style="background:#F6F8FB;padding:14px;text-align:center;border-radius:10px;">
                <b style="font-size:22px;color:#41618A;">
                  ${completedMilestones}/${totalMilestones}
                </b>
                <div style="font-size:11px;">
                  Milestones
                </div>
              </td>
            </tr>
          </table>

          <h2 style="font-size:17px;color:#8A1E2A;margin-top:24px;">
            Executive Attention
          </h2>

          <table style="width:100%;border-collapse:collapse;border:1px solid #F0D7DA;font-size:12px;">
            <thead>
              <tr style="background:#FBEFF1;">
                <th style="padding:10px;text-align:left;">
                  Project
                </th>
                <th style="padding:10px;">
                  Actual
                </th>
                <th style="padding:10px;">
                  Plan
                </th>
                <th style="padding:10px;">
                  Variance
                </th>
                <th style="padding:10px;">
                  Risks
                </th>
                <th style="padding:10px;text-align:left;">
                  Owner
                </th>
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
                <th style="padding:10px;text-align:left;">
                  Project
                </th>
                <th style="padding:10px;text-align:left;">
                  Owner
                </th>
                <th style="padding:10px;">
                  Actual
                </th>
                <th style="padding:10px;">
                  Plan
                </th>
                <th style="padding:10px;">
                  Variance
                </th>
                <th style="padding:10px;">
                  Status
                </th>
                <th style="padding:10px;">
                  Milestones
                </th>
                <th style="padding:10px;">
                  Risks
                </th>
                <th style="padding:10px;">
                  Finish
                </th>
              </tr>
            </thead>

            <tbody>
              ${projectRows}
            </tbody>
          </table>

          <h2 style="font-size:19px;color:#8A1E2A;margin-top:30px;">
            Detailed Project Reports
          </h2>

          <div style="font-size:12px;color:#687180;margin-bottom:12px;">
            The following sections show the available phases, milestones,
            sites, risks, budget, team, QA, payments and survey information
            for every project.
          </div>

          ${detailedProjectBlocks}

          <div style="margin-top:24px;padding-top:14px;border-top:1px solid #E5E9F1;font-size:11px;color:#7B8493;line-height:1.6;">
            This report reads the latest information directly from Firebase
            Realtime Database whenever the GitHub workflow runs.
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
          `PMO Detailed Update — ${totalProjects} Projects · ${averageProgress}% Progress`,

        htmlContent: html
      })
    }
  );

  const brevoResult =
    await brevoResponse.text();

  if (!brevoResponse.ok) {
    throw new Error(
      `Brevo error ${brevoResponse.status}: ${brevoResult}`
    );
  }

  console.log(
    "Detailed executive PMO email sent successfully."
  );

  console.log(brevoResult);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
