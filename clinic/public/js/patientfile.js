/* Patient file: one encounter, or the whole file with every earlier visit */
(async function () {
    const { call, esc } = Desk;
    const q = new URLSearchParams(location.search);
    const consultation = q.get("consultation"), scope = q.get("scope") === "full" ? "full" : "encounter";
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!consultation) { msg.textContent = "No consultation selected."; return; }
    let d;
    try { d = await call("documents.patient_file", { consultation, scope }); } catch (e) { msg.textContent = e.message || "The file could not be loaded."; return; }

    const p = d.patient, full = d.scope === "full";
    const kv = (rows) => (rows.length ? `<dl class="kv">${rows.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "");
    const text = (v) => (v ? `<div style="white-space:pre-line">${esc(v)}</div>` : "");
    const sec = (title, body) => (body ? `<section class="sec"><h2>${esc(title)}</h2><div class="body">${body}</div></section>` : "");
    const vt = (l, v, u, bad) => (v ? `<div class="vt ${bad ? "bad" : ""}"><small>${l}</small><b>${esc(v)}</b> <span class="note" style="margin:0">${u}</span></div>` : "");

    function encounter(e, i) {
        const t = e.triage, m = e.medical;
        const vitals = t ? `<div class="vgrid">
            ${vt("BP", t.bp_systolic ? `${t.bp_systolic}/${t.bp_diastolic}` : "", "mmHg", t.bp_systolic >= 140 || t.bp_diastolic >= 90)}
            ${vt("Pulse", t.pulse_rate, "bpm", t.pulse_rate > 100 || t.pulse_rate < 60)}${vt("Temp", t.temperature, "°C", t.temperature >= 38)}
            ${vt("SpO₂", t.spo2, "%", t.spo2 < 95)}${vt("Resp", t.respiratory_rate, "/min")}${vt("Weight", t.weight_kg, "kg")}${vt("Height", t.height_cm, "cm")}
            ${vt("BMI", t.bmi, t.bmi_category || "")}${vt("Glucose", t.blood_glucose, "mmol/L")}</div>
            ${t.alerts ? `<div class="note warn">Alerts: ${esc(String(t.alerts).replace(/\n/g, "; "))}</div>` : ""}
            ${t.triage_priority ? `<div class="note">Triage priority: ${esc(t.triage_priority)}</div>` : ""}` : "";
        const inv = e.investigations.length ? `<table class="tbl"><thead><tr><th>Investigation</th><th>Sent to</th><th>Status</th><th>Result</th></tr></thead><tbody>
            ${e.investigations.map((r) => `<tr class="${r.flag === "Abnormal" || r.flag === "Critical" ? "abn" : ""}"><td>${esc(r.investigation)}<div class="note" style="margin:0">${esc([r.category, r.urgency !== "Routine" ? r.urgency : "", r.notes].filter(Boolean).join(" · "))}</div></td>
                <td>${esc(r.referred_to || "")}</td><td>${esc(r.status || "")}${r.result_date ? `<div class="note" style="margin:0">${esc(Print.day(r.result_date))}</div>` : ""}</td>
                <td>${r.flag ? `<b>${esc(r.flag)}</b> ` : ""}${esc([r.findings, r.impression].filter(Boolean).join(" — "))}</td></tr>`).join("")}</tbody></table>
            ${e.investigations_notes ? `<div class="note">${esc(e.investigations_notes)}</div>` : ""}${e.results_review_notes ? `<div class="note">Results review: ${esc(e.results_review_notes)}</div>` : ""}` : "";
        const rx = e.prescriptions.length ? `<table class="tbl"><thead><tr><th>Medicine</th><th>Dose / route</th><th>Frequency</th><th class="r">Days</th><th class="r">Prescribed</th><th class="r">Dispensed</th></tr></thead><tbody>
            ${e.prescriptions.map((r) => `<tr><td>${esc(r.drug)}${r.instructions ? `<div class="note" style="margin:0">${esc(r.instructions)}</div>` : ""}</td>
                <td>${esc([r.dose, r.route].filter(Boolean).join(" · "))}</td><td>${esc(r.frequency || "")}</td><td class="r">${r.days || ""}</td><td class="r">${r.quantity || ""}</td>
                <td class="r">${r.not_available ? "Buy externally" : r.dispensed == null ? "—" : esc(r.dispensed)}</td></tr>`).join("")}</tbody></table>` : "";
        const off = [e.sick_leave_days ? `Sick leave: ${e.sick_leave_days} day(s)` : "", e.light_duty_days ? `Light duty: ${e.light_duty_days} day(s)` : "", e.work_related ? "Work-related" : ""].filter(Boolean);
        return `<div class="enc" ${i ? 'style="break-before:page;padding-top:2mm"' : ""}>
            ${full ? `<div class="titlebar" style="margin-top:0"><h1 style="font-size:19px">${esc(Print.day(e.date))} · ${esc(e.type)}</h1><div class="conf">${esc(e.name)}</div></div>` : ""}
            <div style="margin-bottom:10px">${kv([["Seen on", Print.dt(e.date)], ["Seen by", e.doctor], ["Visit", e.visit]])}</div>
            ${sec("Vital signs", vitals)}
            ${sec("Presenting complaint", text(e.complaint) + (e.hpi ? `<div class="note">History: ${esc(e.hpi)}</div>` : ""))}
            ${sec("Review of systems", kv(e.systems))}
            ${sec("Medical history", kv(e.history))}
            ${sec("Examination", kv(e.exam))}
            ${m ? sec(e.type + " findings", kv([["Position", m.job_position]].filter((x) => x[1])) + (m.tests.filter((x) => x.result || x.findings).length ? `<table class="tbl"><thead><tr><th style="width:34%">Examination</th><th style="width:16%">Result</th><th>Findings</th></tr></thead><tbody>${m.tests.filter((x) => x.result || x.findings).map((x) => `<tr class="${x.result === "Abnormal" ? "abn" : ""}"><td>${esc(x.test)}</td><td>${esc(x.result || "")}</td><td>${esc(x.findings || "")}</td></tr>`).join("")}</tbody></table>` : "")
                + (m.remarks ? `<div class="note">Remarks: ${esc(m.remarks)}</div>` : "") + (m.fitness_status ? `<div class="fit ${{ Unfit: "bad", "Temporarily Unfit": "warn", "Fit with Restrictions": "warn" }[m.fitness_status] || ""}" style="margin-top:6px"><div class="big" style="font-size:15px">${esc(m.fitness_status)}</div>${m.restrictions ? `<div><b>Restrictions:</b> ${esc(m.restrictions)}</div>` : ""}${m.valid_until ? `<div>Valid until <b>${esc(Print.day(m.valid_until))}</b></div>` : ""}</div>` : "")) : ""}
            ${sec("Diagnosis", e.diagnoses.length ? `<ul style="margin:0;padding-left:18px">${e.diagnoses.map((x) => `<li><b>${esc(x.diagnosis)}</b>${x.type ? ` <span class="note" style="margin:0">(${esc(x.type)})</span>` : ""}${x.notes ? ` — ${esc(x.notes)}` : ""}</li>`).join("")}</ul>` : "")}
            ${sec("Investigations", inv)}
            ${sec("Plan and treatment", text(e.plan) + (e.procedures ? `<div class="note">Procedures: ${esc(e.procedures)}</div>` : "") + rx)}
            ${sec("Advice, leave and follow-up", [e.advice && `<div>${esc(e.advice)}</div>`, off.length && `<div class="note">${esc(off.join(" · "))}</div>`,
                e.follow_up && `<div class="note">Follow-up: ${esc(Print.day(e.follow_up.date))}${e.follow_up.reason ? ` — ${esc(e.follow_up.reason)}` : ""}</div>`,
                e.referral && `<div class="note">Referred to <b>${esc(e.referral.facility || "another facility")}</b>${e.referral.urgency ? ` (${esc(e.referral.urgency)})` : ""}${e.referral.reason ? ` — ${esc(e.referral.reason)}` : ""}</div>`].filter(Boolean).join(""))}
        </div>`;
    }

    const summary = full ? `<section class="sec"><h2>Visits on record (${d.encounters.length})</h2><div class="body"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Diagnosis</th><th>Seen by</th></tr></thead><tbody>
        ${d.encounters.map((e) => `<tr><td>${esc(Print.day(e.date))}</td><td>${esc(e.type)}</td><td>${esc(e.diagnoses.map((x) => x.diagnosis).join("; ") || "—")}</td><td>${esc(e.doctor || "")}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    const alerts = [p.allergies && `Allergies: ${p.allergies}`, p.chronic_conditions && `Chronic conditions: ${p.chronic_conditions}`, p.blood_group && `Blood group: ${p.blood_group}`].filter(Boolean);
    const latest = d.encounters.find((e) => e.name === d.consultation) || d.encounters[0];

    document.title = `${full ? "Patient file" : "Encounter"} - ${p.full_name} - ${full ? Print.day(new Date().toISOString()) : latest.name}`;
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet">
        <div class="wm">MUTARA</div>
        ${Print.letterhead(d.clinic)}
        ${Print.titlebar(full ? "Patient File" : "Encounter Summary", '<div class="conf">Confidential</div>')}
        ${Print.patientBlock(p, [], full ? [["Visits on record", String(d.encounters.length)]] : [["Encounter", latest.name], ["Seen on", Print.day(latest.date)]])}
        ${alerts.length ? `<div class="note warn" style="margin-bottom:10px"><b>${alerts.map(esc).join(" &nbsp;·&nbsp; ")}</b></div>` : ""}
        ${summary}
        ${d.encounters.map(encounter).join("")}
        ${Print.signBlock(d.signer, full ? "Most recent attending clinician" : "Seen by")}
        ${Print.footer(d, full ? "Patient file" : latest.name)}
    </article>`;
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
