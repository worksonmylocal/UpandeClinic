/* Patient file: one encounter, or the whole file with every earlier visit */
(async function () {
    const { call, esc } = Desk;
    const q = new URLSearchParams(location.search);
    const consultation = q.get("consultation"), scope = q.get("scope") === "full" ? "full" : "encounter";
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!consultation) { msg.textContent = "No consultation selected."; return; }
    let d;
    try { d = await call("documents.patient_file", { consultation, scope }); } catch (e) { msg.textContent = e.message || "The file could not be loaded."; return; }

    const dayOf = (v) => (v ? new Date(String(v).replace(" ", "T")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
    const dt = (v) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); return isNaN(x) ? String(v) : dayOf(v) + ", " + x.toTimeString().slice(0, 5); };
    const c = d.clinic, p = d.patient, full = d.scope === "full";
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    const kv = (rows) => (rows.length ? `<dl class="kv">${rows.map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "");
    const text = (v) => (v ? `<div style="white-space:pre-line">${esc(v)}</div>` : "");
    const sec = (title, body) => (body ? `<section class="sec"><h2>${esc(title)}</h2><div class="body">${body}</div></section>` : "");
    const vt = (l, v, u, bad) => (v ? `<div class="vt ${bad ? "bad" : ""}"><small>${l}</small><b>${esc(v)}</b> <span class="note" style="margin:0">${u}</span></div>` : "");
    const note = (v, cls = "") => `<div class="note ${cls}">${v}</div>`;

    function encounter(e, i) {
        const t = e.triage;
        const vitals = t ? `<div class="vgrid">
            ${vt("BP", t.bp_systolic ? `${t.bp_systolic}/${t.bp_diastolic}` : "", "mmHg", t.bp_systolic >= 140 || t.bp_diastolic >= 90)}
            ${vt("Pulse", t.pulse_rate, "bpm", t.pulse_rate > 100 || t.pulse_rate < 60)}${vt("Temp", t.temperature, "°C", t.temperature >= 38)}
            ${vt("SpO₂", t.spo2, "%", t.spo2 < 95)}${vt("Resp", t.respiratory_rate, "/min")}${vt("Weight", t.weight_kg, "kg")}${vt("Height", t.height_cm, "cm")}
            ${vt("BMI", t.bmi, t.bmi_category || "")}${vt("Glucose", t.blood_glucose, "mmol/L")}</div>
            ${t.alerts ? note("Alerts: " + esc(String(t.alerts).replace(/\n/g, "; ")), "warn") : ""}
            ${t.triage_priority ? note("Triage priority: " + esc(t.triage_priority)) : ""}` : "";
        const labs = e.labs.length ? e.labs.map((l) => `<div style="margin-bottom:6px"><b>${esc(l.test_type)}</b> <span class="note" style="margin:0">${esc([l.status, l.interpretation, l.performed_where === "External" && l.external_facility ? "at " + l.external_facility : "", l.resulted_on && dayOf(l.resulted_on)].filter(Boolean).join(" · "))}</span>
            ${l.results.filter((r) => r.value).length ? `<table class="tbl"><thead><tr><th>Parameter</th><th>Result</th><th>Reference</th><th></th></tr></thead><tbody>${l.results.filter((r) => r.value).map((r) => `<tr class="${r.flag && r.flag !== "Normal" ? "abn" : ""}"><td>${esc(r.parameter)}</td><td>${esc(r.value)} ${esc(r.unit || "")}</td><td>${esc(r.reference || "")}</td><td>${esc(r.flag || "")}</td></tr>`).join("")}</tbody></table>` : ""}
            ${l.result_comments ? note("Lab comment: " + esc(l.result_comments)) : ""}</div>`).join("") + (e.investigations_notes ? note(esc(e.investigations_notes)) : "") : (e.investigations_notes ? note(esc(e.investigations_notes)) : "");
        const rx = e.prescriptions.length ? `<table class="tbl"><thead><tr><th>Medicine</th><th>Dose / route</th><th>Frequency</th><th class="r">Days</th><th class="r">Prescribed</th><th class="r">Dispensed</th></tr></thead><tbody>
            ${e.prescriptions.map((r) => `<tr><td>${esc(r.drug)}${r.instructions ? `<div class="note" style="margin:0">${esc(r.instructions)}</div>` : ""}</td>
                <td>${esc([r.dose, r.route].filter(Boolean).join(" · "))}</td><td>${esc(r.frequency || "")}</td><td class="r">${r.days || ""}</td><td class="r">${r.quantity || ""}</td>
                <td class="r">${r.not_available ? "Buy externally" : r.dispensed == null ? "—" : esc(r.dispensed)}</td></tr>`).join("")}</tbody></table>` : "";
        const procs = e.procedure_rows.length ? note("Procedures billed: " + e.procedure_rows.map((r) => esc(r.procedure) + (r.qty > 1 ? " × " + r.qty : "")).join(", ")) : "";
        const off = [e.sick_leave_days ? `Sick leave: ${e.sick_leave_days} day(s)` : "", e.light_duty_days ? `Light duty: ${e.light_duty_days} day(s)` : "", e.work_related ? "Work-related" : ""].filter(Boolean);
        const inc = e.incidents.length ? e.incidents.map((x) => `<div><b>${esc(x.report_type)} · ${esc(x.severity)}</b> on ${esc(dayOf(x.incident_date))} ${esc(x.name)}<div class="note" style="margin:0">${esc([x.cause, x.injury_type, x.body_part, x.outcome].filter(Boolean).join(" · "))}</div>${esc(x.description || "")}</div>`).join("") : "";
        return `<div class="enc" ${i ? 'style="break-before:page;padding-top:2mm"' : ""}>
            ${full ? `<div class="titlebar" style="margin-top:0"><h1 style="font-size:19px">${esc(dayOf(e.date))} · ${esc(e.consultation_type && e.consultation_type !== "Consultation" ? e.consultation_type : (e.type || ""))}</h1><div class="conf">${esc(e.name)}</div></div>` : ""}
            <div style="margin-bottom:10px">${kv([["Seen on", dt(e.date)], ["Seen by", e.doctor], ["Visit", e.visit]].filter((x) => x[1]))}</div>
            ${sec("Vital signs", vitals)}
            ${sec("Presenting complaint", text(e.complaint) + (e.hpi ? note("History: " + esc(e.hpi)) : ""))}
            ${sec("Review of systems", kv(e.systems))}
            ${sec("Medical history", kv(e.history))}
            ${sec("Examination", kv(e.exam))}
            ${e.medical ? sec(e.consultation_type + " findings", kv([["Position", e.medical.job_position]].filter((x) => x[1])) + (e.medical.tests.filter((x) => x.result || x.findings).length ? `<table class="tbl"><thead><tr><th style="width:34%">Examination</th><th style="width:16%">Result</th><th>Findings</th></tr></thead><tbody>${e.medical.tests.filter((x) => x.result || x.findings).map((x) => `<tr class="${x.result === "Abnormal" ? "abn" : ""}"><td>${esc(x.test)}</td><td>${esc(x.result || "")}</td><td>${esc(x.findings || "")}</td></tr>`).join("")}</tbody></table>` : "")
                + (e.medical.remarks ? note("Remarks: " + esc(e.medical.remarks)) : "") + (e.medical.fitness_status ? note(`<b>Fitness outcome: ${esc(e.medical.fitness_status)}</b>${e.medical.restrictions ? " — " + esc(e.medical.restrictions) : ""}${e.medical.valid_until ? " · valid until " + esc(dayOf(e.medical.valid_until)) : ""}`) : "")) : ""}
            ${sec("Diagnosis", e.diagnoses.length || e.impression ? (e.diagnoses.length ? `<ul style="margin:0;padding-left:18px">${e.diagnoses.map((x) => `<li><b>${esc(x.diagnosis)}</b>${x.type ? ` <span class="note" style="margin:0">(${esc(x.type)})</span>` : ""}${x.notes ? ` — ${esc(x.notes)}` : ""}</li>`).join("")}</ul>` : "") + (e.impression ? note("Impression: " + esc(e.impression)) : "") : "")}
            ${sec("Laboratory", labs)}
            ${sec("Plan and treatment", text(e.plan) + (e.procedures ? note("Procedures: " + esc(e.procedures)) : "") + procs + rx)}
            ${sec("Accident / incident", inc)}
            ${sec("Advice, leave and follow-up", [e.advice && `<div>${esc(e.advice)}</div>`, off.length && note(esc(off.join(" · "))),
                e.follow_up && note("Follow-up: " + esc(dayOf(e.follow_up.date)) + (e.follow_up.reason ? ` — ${esc(e.follow_up.reason)}` : "")),
                e.referral && note(`Referred to <b>${esc(e.referral.facility || "another facility")}</b>${e.referral.urgency ? ` (${esc(e.referral.urgency)})` : ""}${e.referral.reason ? ` — ${esc(e.referral.reason)}` : ""}`)].filter(Boolean).join(""))}
        </div>`;
    }

    const summary = full ? `<section class="sec"><h2>Visits on record (${d.encounters.length})</h2><div class="body"><table class="tbl"><thead><tr><th>Date</th><th>Diagnosis</th><th>Seen by</th></tr></thead><tbody>
        ${d.encounters.map((e) => `<tr><td>${esc(dayOf(e.date))}</td><td>${esc(e.diagnoses.map((x) => x.diagnosis).join("; ") || e.impression || "—")}</td><td>${esc(e.doctor || "")}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    const alerts = [p.allergies && `Allergies: ${p.allergies}`, p.chronic_conditions && `Chronic conditions: ${p.chronic_conditions}`, p.blood_group && `Blood group: ${p.blood_group}`].filter(Boolean);
    const latest = d.encounters.find((e) => e.name === d.consultation) || d.encounters[0];
    const s = d.signer;
    const row = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : "");

    document.title = `${full ? "Patient file" : "Encounter"} - ${p.full_name} - ${full ? dayOf(new Date().toISOString()) : latest.name}`;
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet">
        <div class="wm">CONFIDENTIAL</div>
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="titlebar"><h1>${full ? "Patient File" : "Encounter Summary"}</h1><div class="conf">Confidential</div></div>
        <section class="meta">
            <dl><dt>Patient</dt><dd class="big">${esc(p.full_name)}</dd>
                ${row("Age / Sex", [p.age, p.sex].filter(Boolean).join(" / "))}${row("ID / Passport", p.national_id)}
                ${p.patient_type === "Employee" ? row("Staff No.", p.staff_no || p.employee) + row("Department", p.department || p.section) + row("Employer", p.employer) : row("Phone", p.phone)}</dl>
            <dl>${row("Patient No.", p.name)}${full ? row("Visits on record", String(d.encounters.length)) : row("Encounter", latest.name) + row("Seen on", dayOf(latest.date))}</dl>
        </section>
        ${alerts.length ? `<div class="note warn" style="margin-bottom:10px"><b>${alerts.map(esc).join(" &nbsp;·&nbsp; ")}</b></div>` : ""}
        ${summary}
        ${d.encounters.map(encounter).join("")}
        <div class="certify"><div><span class="sig">${s.signature ? `<img src="${esc(s.signature)}" alt="">` : ""}</span>
            <small>${full ? "Most recent attending clinician" : "Seen by"}</small><b>${esc(s.name || "—")}</b>
            <div class="note" style="margin:0">${esc([s.designation, s.registration_no && "Reg. No. " + s.registration_no].filter(Boolean).join(" · ") || "Doctor / Clinical Officer")}</div></div>
            <div><div class="stamp-box">Clinic stamp</div></div></div>
        <footer class="foot"><span class="c">CONFIDENTIAL</span> — Confidential patient record, for the patient and the treating clinicians only.
            <div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>${full ? "Patient file" : esc(latest.name)} · Printed ${esc(dt(d.printed_on))} by ${esc(d.printed_by)}</span></div></footer>
    </article>`;
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
