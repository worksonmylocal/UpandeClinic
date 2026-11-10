/* Monthly accidents & incidents report, laid out for A4 printing */
(async function () {
    const { call, esc } = Desk;
    const qs = new URLSearchParams(location.search);
    const month = qs.get("month");
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!month) { msg.textContent = "No month selected."; return; }
    let d;
    try { d = await call("incident.report", { month, patient_type: qs.get("patient_type") || undefined, employer: qs.get("employer") || undefined, report_type: qs.get("report_type") || undefined }); }
    catch (e) { msg.textContent = e.message || "The report could not be loaded."; return; }
    const dt = (v, time) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); if (isNaN(x)) return String(v); const day = x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); return time ? day + ", " + x.toTimeString().slice(0, 5) : day; };
    const c = d.clinic, s = d.summary, pv = d.previous;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    const ref = `AIR-${d.month.replace("-", "")}`;
    const f = d.filters, scope = [f.patient_type && (f.patient_type === "Employee" ? "Employees" : "Community members"), f.report_type, f.employer].filter(Boolean).join(" · ") || "All patients";
    const delta = (a, b) => (a === b ? "no change" : (a > b ? "up " : "down ") + Math.abs(a - b));
    const dist = (rows, title) => `<div class="sec"><h2>${esc(title)}</h2><div class="body">${rows.length ? `<table class="tbl"><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r" style="width:50px">${r.count}</td><td style="width:42%"><div style="height:7px;background:var(--brand);border-radius:3px;width:${Math.round(r.count / Math.max(...rows.map((x) => x.count), 1) * 100)}%"></div></td></tr>`).join("")}</tbody></table>` : '<div class="note">None recorded.</div>'}</div></div>`;
    const tile = (l, v, sub2) => `<td style="text-align:center;border:1px solid var(--hair);padding:8px 4px"><div style="font:700 20px var(--sans)">${v}</div><div style="font:600 8px var(--sans);letter-spacing:1px;text-transform:uppercase;color:var(--ink-mute)">${l}</div>${sub2 ? `<div style="font-size:9px;color:var(--ink-mute)">${sub2}</div>` : ""}</td>`;

    const reviewed = d.rows.filter((r) => r.root_cause || r.corrective_actions);
    const findings = [];
    if (!s.total) findings.push("No accidents, incidents or near misses were recorded this month.");
    else {
        findings.push(`${s.total} event${s.total === 1 ? "" : "s"} recorded (${delta(s.total, pv.total)} on ${d.previous_period}): ${s.accidents} accident${s.accidents === 1 ? "" : "s"}, ${s.incidents} incident${s.incidents === 1 ? "" : "s"} and ${s.near_misses} near miss${s.near_misses === 1 ? "" : "es"}.`);
        if (s.serious) findings.push(`${s.serious} event${s.serious === 1 ? " was" : "s were"} severe or fatal.`);
        if (s.work_related) findings.push(`${s.work_related} ${s.work_related === 1 ? "was" : "were"} work-related, with ${s.lost_days} working day${s.lost_days === 1 ? "" : "s"} lost.`);
        if (d.by_cause[0] && d.by_cause[0].label !== "Not stated") findings.push(`Leading cause: ${d.by_cause[0].label} (${d.by_cause[0].count}).`);
        if (d.recurring.length) findings.push(`Repeat locations: ${d.recurring.map((r) => `${r.label} (${r.count})`).join(", ")}.`);
        if (s.statutory_pending) findings.push(`${s.statutory_pending} statutory (DOSHS) report${s.statutory_pending === 1 ? " is" : "s are"} still to be filed.`);
    }

    document.title = `Accidents and Incidents ${d.period}`;
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet">
        <div class="wm" style="font-size:64px">CONFIDENTIAL</div>
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="titlebar"><div><h1>Accidents &amp; Incidents Report</h1><div class="rcpt-no">No. ${esc(ref)}</div></div><div class="conf">Confidential</div></div>
        <section class="meta"><dl><dt>Period</dt><dd class="big">${esc(d.period)}</dd><dt>Scope</dt><dd>${esc(scope)}</dd></dl>
            <dl><dt>Compared with</dt><dd>${esc(d.previous_period)}</dd><dt>Prepared</dt><dd>${esc(dt(d.printed_on))}</dd></dl></section>
        <table style="width:100%;border-collapse:collapse;margin:6px 0 12px"><tr>
            ${tile("Events", s.total, `${delta(s.total, pv.total)} vs ${esc(d.previous_period)}`)}${tile("Accidents", s.accidents)}${tile("Serious", s.serious, s.fatal ? s.fatal + " fatal" : "")}
            ${tile("Work-related", s.work_related)}${tile("Days lost", s.lost_days)}${tile("Open", s.open, s.statutory_pending + " statutory pending")}</tr></table>
        <div class="sec"><h2>Summary</h2><div class="body"><ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.55">${findings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
        ${s.total ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
            <div>${dist(d.by_severity, "By severity")}${dist(d.by_cause, "By mechanism / cause")}${dist(d.by_time, "By time of day")}</div>
            <div>${dist(d.by_type, "By type")}${dist(d.by_department, "By department / section")}${dist(d.by_body_part, "By body part")}</div></div>
        <div class="sec"><h2>Register of events</h2><div class="body"><table class="tbl"><thead><tr><th style="width:68px">Date</th><th>Patient</th><th>Type</th><th>Severity</th><th>What happened</th><th>Outcome</th><th class="r">Days</th></tr></thead><tbody>
            ${d.rows.map((r) => `<tr class="${r.severity === "Severe" || r.severity === "Fatal" ? "abn" : ""}"><td>${esc(dt(r.incident_date))}</td><td>${esc(r.patient_name)}<br><span style="font-size:9px;color:var(--ink-mute)">${esc(r.department || r.employer || r.patient_type || "")}${r.work_related ? " · work-related" : ""}</span></td>
            <td>${esc(r.report_type)}</td><td>${esc(r.severity)}</td><td>${esc(r.description || "")}<br><span style="font-size:9px;color:var(--ink-mute)">${esc([r.location, r.cause, r.injury_type, r.body_part].filter(Boolean).join(" · "))}</span></td><td>${esc(r.outcome || "—")}</td><td class="r">${r.lost_days || ""}</td></tr>`).join("")}
        </tbody></table></div></div>
        ${reviewed.length ? `<div class="sec"><h2>Root causes &amp; corrective actions</h2><div class="body">${reviewed.map((r) => `<div style="font-size:11px;margin-bottom:6px"><b>${esc(r.name)} · ${esc(r.patient_name)}</b>${r.root_cause ? `<br><i>Root cause:</i> ${esc(r.root_cause)}` : ""}${r.corrective_actions ? `<br><i>Action:</i> ${esc(r.corrective_actions)}` : ""}</div>`).join("")}</div></div>` : ""}` : ""}
        <div class="certify"><div><span class="sig"></span><small>Prepared by · ${esc(d.printed_by)}</small></div><div><div class="stamp-box">Clinic stamp</div></div></div>
        <footer class="foot"><div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>Printed ${esc(dt(d.printed_on, true))} by ${esc(d.printed_by)} · ${esc(ref)}</span></div></footer>
    </article>`;
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
