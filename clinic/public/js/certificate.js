/* Pre- and post-employment medical examination report */
(async function () {
    const { call, esc } = Desk;
    const consultation = new URLSearchParams(location.search).get("consultation");
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!consultation) { msg.textContent = "No consultation selected."; return; }
    let d;
    try { d = await call("documents.medical_certificate", { consultation }); } catch (e) { msg.textContent = e.message || "The report could not be loaded."; return; }

    const dayOf = (v) => (v ? new Date(String(v).replace(" ", "T")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
    const dt = (v) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); return isNaN(x) ? String(v) : dayOf(v) + ", " + x.toTimeString().slice(0, 5); };
    const c = d.clinic, p = d.patient, t = d.triage, s = d.signer;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    const pre = d.exam_type.startsWith("Pre");
    const vt = (l, v, u, bad) => (v ? `<div class="vt ${bad ? "bad" : ""}"><small>${l}</small><b>${esc(v)}</b> <span class="note" style="margin:0">${u}</span></div>` : "");
    const row = (l, v) => (v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : "");
    const cls = { Unfit: "bad", "Temporarily Unfit": "warn", "Fit with Restrictions": "warn" }[d.fitness_status] || "";
    const history = Object.entries(d.history).filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    const done = d.tests.filter((x) => x.result || x.findings);
    let sec = 0;
    const n = () => ++sec;
    const ref = `MED-${d.consultation}`;

    document.title = `${d.exam_type} - ${p.full_name} - ${d.consultation}`;
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet">
        <div class="wm" style="font-size:64px">CONFIDENTIAL</div>
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="titlebar"><div><h1>${esc(d.exam_type)} Report</h1><div class="rcpt-no">No. ${esc(d.consultation)}</div></div><div class="conf">Confidential</div></div>
        <section class="meta">
            <dl><dt>Name</dt><dd class="big">${esc(p.full_name)}</dd>
                ${row("Age / Sex", [p.age, p.sex].filter(Boolean).join(" / "))}${row("ID / Passport", p.national_id)}
                ${p.patient_type === "Employee" ? row("Staff No.", p.staff_no || p.employee) + row("Employer", p.employer) : row("Phone", p.phone)}</dl>
            <dl>${row("Patient No.", p.name)}${row(pre ? "Position applied" : "Position held", d.job_position)}${row("Examined on", dayOf(d.consultation_date))}</dl>
        </section>
        ${t ? `<section class="sec"><h2>${n()} · Vital signs</h2><div class="body"><div class="vgrid">
            ${vt("BP", t.bp_systolic ? `${t.bp_systolic}/${t.bp_diastolic}` : "", "mmHg", t.bp_systolic >= 140 || t.bp_diastolic >= 90)}
            ${vt("Pulse", t.pulse_rate, "bpm", t.pulse_rate > 100 || t.pulse_rate < 60)}${vt("Temperature", t.temperature, "°C", t.temperature >= 38)}
            ${vt("SpO₂", t.spo2, "%", t.spo2 < 95)}${vt("Weight", t.weight_kg, "kg")}${vt("Height", t.height_cm, "cm")}${vt("BMI", t.bmi, t.bmi_category || "")}
        </div></div></section>` : ""}
        ${history ? `<section class="sec"><h2>${n()} · Medical history</h2><div class="body"><dl class="kv">${history}</dl></div></section>` : ""}
        <section class="sec"><h2>${n()} · Examination findings</h2><div class="body">
            ${done.length ? `<table class="tbl"><thead><tr><th style="width:34%">Examination</th><th style="width:16%">Result</th><th>Findings</th></tr></thead><tbody>
                ${done.map((x) => `<tr class="${x.result === "Abnormal" ? "abn" : ""}"><td>${esc(x.test)}</td><td>${esc(x.result || "")}</td><td>${esc(x.findings || "")}</td></tr>`).join("")}</tbody></table>`
                : '<div class="note">No examination findings recorded.</div>'}
            ${d.remarks ? `<div class="note">Examiner's remarks: ${esc(d.remarks)}</div>` : ""}
            ${d.labs.length ? `<div class="note">Laboratory: ${d.labs.map(esc).join("; ")}</div>` : ""}
            ${d.diagnoses.length ? `<div class="note">Conditions noted: ${d.diagnoses.map((x) => esc(x.diagnosis)).join("; ")}</div>` : ""}
        </div></section>
        <section class="sec"><h2>${n()} · Conclusion</h2><div class="body"><div class="fit ${cls}" style="border:1px solid var(--hair);border-radius:6px;padding:10px 14px">
            <div class="big" style="font:700 16px var(--sans)">${esc(d.fitness_status || "Outcome not recorded")}</div>
            ${d.restrictions ? `<div style="margin-top:4px"><b>Restrictions / conditions:</b> ${esc(d.restrictions)}</div>` : ""}
            ${d.valid_until ? `<div style="margin-top:4px">Valid until <b>${esc(dayOf(d.valid_until))}</b></div>` : ""}
        </div></div></section>
        <div class="certify"><div><span class="sig">${s.signature ? `<img src="${esc(s.signature)}" alt="">` : ""}</span>
            <small>Examined and certified by</small><b>${esc(s.name || "—")}</b>
            <div class="note" style="margin:0">${esc([s.designation, s.registration_no && "Reg. No. " + s.registration_no].filter(Boolean).join(" · ") || "Doctor / Clinical Officer")}</div></div>
            <div><div class="stamp-box">Clinic stamp</div></div></div>
        <footer class="foot"><span class="c">CONFIDENTIAL</span> — Medical examination report for the person named above.
            <div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>${esc(ref)} · Printed ${esc(dt(d.printed_on))} by ${esc(d.printed_by)}</span></div></footer>
    </article>`;
    if (!s.can_sign) {
        const w = document.getElementById("warn");
        w.style.display = "";
        w.innerHTML = `<b>Not yet signable:</b> ${esc(s.name || "The clinician")} has no Doctor or Clinical Officer profile. Add one under <b>Clinic Staff Profile</b> (with the registration number) so the report carries the right credentials.`;
    }
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
