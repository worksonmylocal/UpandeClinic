/* Doctor / consultation page: queue and the single-screen patient workspace */
(async function () {
    const { call, $, $$, esc, num, timeOf, dateOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, suggest, banner, masters, COLORS } = Desk;

    await Desk.shell({
        page: "consultation",
        eyebrow: "Mutara Clinic · Doctor",
        title: "Consultation",
        sub: "Patients sent from triage, and everything you need to see, treat and refer them",
        tools: `<button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => { if (tab === "insights") loadInsights(); else if (tab === "month") loadMonth(); });
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });

    const M = await masters();
    const PRIORITY_ORDER = { Emergency: 0, Urgent: 1, Routine: 2 };
    let dash, ws, state, dirty = false;
    const period = Desk.periodToggle($("#period"), () => loadInsights(), "day");

    // ============================================================ queue
    async function loadAll() {
        dash = await call("consultation.dashboard");
        renderKpis(dash.kpis);
        renderQueues(dash);
        renderCompleted(dash.completed);
        if ($("#tab-insights").classList.contains("on")) loadInsights();
        if ($("#tab-month").classList.contains("on")) loadMonth();
    }

    function renderKpis(k) {
        kpis($("#kpis"), [
            { label: "Waiting for Doctor", value: k.waiting, cls: k.waiting ? "warn" : "", unit: k.emergency ? `${k.emergency} urgent / emergency` : k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "Queue is clear" },
            { label: "Results to Review", value: k.results_pending, cls: k.results_received ? "info" : "", unit: k.results_pending ? `${k.results_received} result${k.results_received === 1 ? "" : "s"} received` : "No investigations out" },
            { label: "Open Consultations", value: k.in_progress, unit: "In progress now" },
            { label: "Seen Today", value: k.seen_today, cls: "good", unit: `${Desk.split(k.employees_today)}` },
            { label: "Avg Wait for Doctor", value: `${k.avg_wait}<span style="font-size:14px;font-weight:500"> min</span>`, unit: "Triage → consultation, today" },
            { label: "Referred Out / Sick-off", value: `${k.referrals_out} <span style="font-size:14px;color:var(--ink-mute)">/ ${k.sick_days}d</span>`, unit: `${k.work_related} work-related · ${k.follow_ups_week} follow-ups this week` },
        ]);
    }

    function queueCard(r, button, extra = "") {
        return `<div class="qcard"><div class="qcard__stripe ${esc(r.priority || "")}"></div>
            <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                ${r.priority ? `<span class="tag tag--${esc(r.priority)}">${esc(r.priority)}</span>` : ""}
                ${r.visit_purpose && r.visit_purpose !== "Consultation" ? pill(r.visit_purpose, "info") : ""}</div>
            <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}${r.department ? " · " + esc(r.department) : ""}</div>
            ${r.chief_complaint ? `<div class="qcard__note">${esc(r.chief_complaint)}</div>` : ""}
            ${r.alerts ? `<div class="qcard__note alert">⚠ ${esc(r.alerts.replace(/\n/g, "; "))}</div>` : ""}${extra}</div>
            <div class="qcard__side">${r.wait_minutes != null ? wait(r.wait_minutes, 20, 45) : ""}${button}</div></div>`;
    }

    function renderQueues(d) {
        $("#waiting-meta").textContent = d.waiting.length ? `${d.waiting.length} waiting` : "";
        $("#waiting").innerHTML = d.waiting.length
            ? d.waiting.map((r) => queueCard(r, `<button class="btn btn--primary btn--sm" data-open="${esc(r.visit)}">Start consultation</button>`)).join("")
            : empty("No patients waiting.");

        $("#results-meta").textContent = d.results.length ? `${d.results.length} patient${d.results.length === 1 ? "" : "s"}` : "";
        $("#results").innerHTML = d.results.length
            ? d.results.map((r) => `<div class="qcard qcard--link" data-review="${esc(r.visit)}" data-received="${r.received ? 1 : 0}" tabindex="0" role="button" title="Open this patient's consultation"><div class="qcard__stripe ${r.abnormal ? "Emergency" : r.received ? "Urgent" : ""}"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                    ${r.received ? pill(`${r.received} result${r.received === 1 ? "" : "s"} in`, "info") : pill("Awaiting results", "mute")}
                    ${r.abnormal ? pill("Abnormal", "bad") : ""}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))} · referred ${esc(dateOf(r.since).slice(5))}</div>
                <div class="qcard__note">${r.tests.map((t) => `${esc(t.investigation)} <span style="color:${t.result_status === "Results Received" ? "var(--info)" : "var(--ink-mute)"}">(${t.category === "Imaging" ? "imaging" : "lab"}${t.result_status === "Results Received" ? ", received" : ""})</span>`).join(" · ")}</div></div>
                <div class="qcard__side">${wait(r.wait_minutes, 1440, 4320)}
                    <span class="btn ${r.received ? "btn--signal" : ""} btn--sm">${r.received ? "Review results" : "Open"}</span></div></div>`).join("")
            : empty("No investigations awaiting results.");
        // Clicking the patient reopens the consultation they were referred from. With results in, it opens on the review
        // tab; otherwise on the plan, where the doctor can also prescribe and finish.
        $$("#results [data-review]").forEach((c) => {
            const open = () => openVisit(c.dataset.review, c.dataset.received === "1" ? "review" : "plan");
            c.addEventListener("click", open);
            c.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
        });

        $("#progress").innerHTML = d.in_progress.length
            ? d.in_progress.map((r) => queueCard(r, `<button class="btn btn--sm" data-open="${esc(r.visit)}">Continue</button>`)).join("")
            : empty("None open.");

        $("#flight").innerHTML = d.in_flight.length
            ? d.in_flight.map((r) => `<div class="qcard"><div class="qcard__stripe"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}</div></div>
                <div class="qcard__side">${pill(r.status, "warn")}
                <button class="btn btn--link btn--sm" data-open="${esc(r.visit)}">Open</button></div></div>`).join("")
            : empty("No one at the pharmacy.");
        $$("[data-open]").forEach((b) => b.addEventListener("click", () => openVisit(b.dataset.open)));
    }

    const FIT_CLS = { Fit: "good", "Fit with Restrictions": "warn", "Temporarily Unfit": "warn", Unfit: "bad", "Pending Investigations": "info" };
    const outcome = (r) => (r.consultation_type && r.consultation_type !== "Consultation"
        ? pill(`${r.consultation_type.split("-")[0]}: ${r.fitness_status || "—"}`, FIT_CLS[r.fitness_status] || "mute")
        : r.refer_out ? pill("Referred out", "warn") : pill("Treated", "good"));

    function renderCompleted(rows) {
        $("#completed").innerHTML = rows.length ? `<table class="dtable"><tr><th>Time</th><th>Patient</th><th>Type</th><th>Diagnosis</th><th class="num">Sick-off</th><th>Outcome</th></tr>
            ${rows.map((r) => `<tr><td>${timeOf(r.consultation_date)}</td><td><b style="color:var(--ink)">${esc(r.patient_name)}</b><br><span class="printnote">${esc(ageSex(r))}</span></td>
            <td>${typeTag(r.patient_type)}</td><td>${esc(r.diagnoses || (r.consultation_type !== "Consultation" ? r.consultation_type : "—"))}</td><td class="num">${r.sick_leave_days || "—"}</td>
            <td>${outcome(r)}</td></tr>`).join("")}</table>` : empty("No completed consultations yet today.");
    }

    async function loadMonth() {
        const d = await call("consultation.seen_month");
        const s = d.summary;
        $("#month-meta").textContent = d.month;
        kpis($("#month-kpis"), [
            { label: "Seen This Month", value: s.total, cls: "good", unit: d.month },
            { label: "Employees Treated", value: s.employees, unit: "Patients seen" },
            { label: "Referred Out", value: s.referred, cls: s.referred ? "warn" : "", unit: "To other facilities" },
            { label: "Sick-off Days", value: s.sick_days, unit: `${s.work_related} work-related cases` },
        ]);
        $("#seen-month").innerHTML = d.rows.length ? `<table class="dtable"><tr><th>Date</th><th>Patient</th><th>Type</th><th>Diagnosis</th><th class="num">Sick-off</th><th>Outcome</th></tr>
            ${d.rows.map((r) => `<tr><td>${esc(dateOf(r.consultation_date).slice(5))} ${timeOf(r.consultation_date)}</td><td><b style="color:var(--ink)">${esc(r.patient_name)}</b><br><span class="printnote">${esc(ageSex(r))}</span></td>
            <td>${typeTag(r.patient_type)}</td><td>${esc(r.diagnoses || (r.consultation_type !== "Consultation" ? r.consultation_type : "—"))}</td><td class="num">${r.sick_leave_days || "—"}</td>
            <td>${outcome(r)}</td></tr>`).join("")}</table>` : empty("No completed consultations yet this month.");
    }

    async function loadInsights() {
        const d = await call("consultation.insights", { period: period.value });
        const WORD = { day: "today", week: "this week", month: "this month" }[period.value];
        $("#range-meta").textContent = d.range.from === d.range.to ? Desk.dateOf(d.range.from) : `${d.range.from} → ${d.range.to}`;
        const P = Desk.PALETTE;
        const ico = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

        // Top diagnoses: a ring and a ranked list (no line charts)
        const dx = d.top_diagnoses;
        $("#dx-meta").textContent = d.diagnosed ? `${d.diagnosed} diagnoses ${WORD}` : "";
        $("#dx-mid").innerHTML = `<b>${d.diagnosed}</b><span>Diagnoses</span>`;
        chart("dx-chart", { type: "doughnut", data: { labels: dx.map((r) => r.label), datasets: [{ data: dx.length ? dx.map((r) => r.total) : [1], backgroundColor: dx.length ? dx.map((_, i) => P[i % P.length]) : ["rgba(10,10,10,0.06)"], borderWidth: 4, borderColor: "#fff", hoverOffset: 8, borderRadius: 8 }] }, options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { enabled: dx.length > 0 } } } });
        Desk.ranked($("#dx-rank"), dx.map((r) => ({ label: r.label, value: r.total, sub: d.diagnosed ? `${Math.round(r.total * 100 / d.diagnosed)}%` : "" })));

        // How long a consultation takes: from when it started to when the doctor closed it
        const u = d.duration;
        $("#dur-meta").textContent = u.measured ? `${u.measured} timed ${WORD}` : "";
        Desk.livelyTiles($("#duration"), u.measured ? [
            { label: "Average", value: u.average, unit: "minutes per consultation", color: P[0], icon: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') },
            { label: "Shortest", value: u.shortest, unit: "minutes", color: P[2], icon: ico('<path d="M5 12h14M13 6l6 6-6 6"/>') },
            { label: "Longest", value: u.longest, unit: "minutes", color: P[1], icon: ico('<path d="M3 12h14M11 6l6 6-6 6M21 5v14"/>') },
        ] : []);
        if (!u.measured) $("#duration").innerHTML = empty("No timed consultations yet. The clock is recorded when a consultation is completed or sent to the pharmacy.");

        // Workdays the doctor has prescribed: rest days and light duty
        const w = d.workload;
        $("#days-meta").textContent = w.sick_offs || w.light_duties ? `${w.sick_employees} employee${w.sick_employees === 1 ? "" : "s"} off ${WORD}` : "";
        Desk.livelyTiles($("#workdays"), [
            { label: "Sick-off days", value: w.sick_days, unit: `${w.sick_offs} sick-off${w.sick_offs === 1 ? "" : "s"}${w.sick_offs ? ` · ${(w.sick_days / w.sick_offs).toFixed(1)} days each` : ""}`, color: P[5], icon: ico('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>') },
            { label: "Light-duty days", value: w.light_duty_days, unit: `${w.light_duties} case${w.light_duties === 1 ? "" : "s"}`, color: P[3], icon: ico('<path d="M12 3v18M5 9l7-6 7 6"/>') },
        ]);

        // Workload
        $("#load-meta").textContent = WORD;
        Desk.livelyTiles($("#workload"), [
            { label: "Consultations", value: w.consultations, unit: `${w.patients} patient${w.patients === 1 ? "" : "s"}`, color: P[0], icon: ico('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>') },
            { label: "Investigations", value: w.investigations, unit: "requested", color: P[4], icon: ico('<path d="M9 3h6v4l4 11a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-11z"/>') },
            { label: "Drugs prescribed", value: w.prescriptions, unit: "medicine lines", color: P[2], icon: ico('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M10 8l4 8" />') },
            { label: "Referred out", value: w.referrals, unit: "to other facilities", color: P[1], icon: ico('<path d="M5 12h14M13 6l6 6-6 6"/>') },
            { label: "Work-related", value: w.work_related, unit: "cases", color: P[5], icon: ico('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>') },
            { label: "Follow-ups", value: w.follow_ups, unit: "booked", color: P[6], icon: ico('<path d="M20 6 9 17l-5-5"/>') },
        ]);

        $("#series-title").textContent = period.value === "day" ? "Consultations by Hour" : "Consultations by Day";
        chart("day-chart", { type: "bar", data: { labels: d.series.labels, datasets: [{ label: "Consultations", data: d.series.values, backgroundColor: d.series.values.map((_, i) => P[i % P.length]), borderRadius: 8, maxBarThickness: 30 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }

    // ============================================================ routing
    async function openVisit(visit, tab) {
        let data = await call("consultation.workspace", { visit });
        if (!data.consultation) {
            await call("consultation.start", { visit });
            data = await call("consultation.workspace", { visit });
        }
        renderWorkspace(data);
        if (tab) { const t = $(`.subtab[data-p=${tab}]`); if (t) t.click(); }
        location.hash = "#/" + visit; // hashchange sees the workspace is already showing and ignores it
    }

    function showQueue() {
        $("#view-ws").style.display = "none";
        $("#view-queue").style.display = "";
        $("#pagehead").style.display = "";
        loadAll();
    }

    window.addEventListener("hashchange", async () => {
        const visit = location.hash.replace("#/", "");
        if (!visit) { dirty = false; showQueue(); return; }
        const showing = ws && ws.visit.name === visit && $("#view-ws").style.display !== "none";
        if (!showing) await openVisit(visit);
    });
    window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

    // ============================================================ workspace
    const FREQ = { od: 1, "once daily": 1, bd: 2, bid: 2, tds: 3, tid: 3, qds: 4, qid: 4, nocte: 1, stat: 1 };
    const FITNESS = ["", "Fit", "Fit with Restrictions", "Temporarily Unfit", "Unfit", "Pending Investigations"];
    const isMedical = () => ws.consultation.consultation_type !== "Consultation";

    function vitalTile(label, value, unit, level) {
        return !value ? "" : `<div class="vital ${level || ""}"><small>${label}</small><b>${esc(value)}</b><em>${unit}</em></div>`;
    }
    const info = (label, value) => (value ? `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>` : "");

    function renderWorkspace(data) {
        ws = data;
        const c = ws.consultation, p = ws.patient, t = ws.triage, v = ws.visit;
        const isEmp = p.patient_type === "Employee";
        const pending = (c.investigations || []).some((r) => (r.result_status || "Awaiting Results") !== "Reviewed");
        const locked = c.status === "Completed" && !pending; // a completed consultation stays editable until its results are reviewed
        const reviewing = c.status === "Completed" && pending;
        ws.locked = locked;
        const medical = isMedical();
        state = {
            inv: (c.investigations || []).map((r) => ({ ...r })),
            dx: (c.diagnoses || []).map((r) => ({ ...r })),
            rx: (c.prescriptions || []).map((r) => ({ ...r })),
            med: (c.medical_tests || []).map((r) => ({ ...r })),
        };
        dirty = false;
        $("#view-queue").style.display = "none";
        $("#pagehead").style.display = "none";
        const root = $("#view-ws");
        root.style.display = "";

        const tl = t || {};
        const vitals = t ? [
            vitalTile("BP", tl.bp_systolic ? `${tl.bp_systolic}/${tl.bp_diastolic}` : "", "mmHg", tl.bp_systolic >= 140 || tl.bp_diastolic >= 90 ? "bad" : tl.bp_systolic < 90 ? "warn" : ""),
            vitalTile("Pulse", tl.pulse_rate, "bpm", tl.pulse_rate > 100 || tl.pulse_rate < 60 ? "warn" : ""),
            vitalTile("Temp", tl.temperature, "°C", tl.temperature >= 38 ? "bad" : tl.temperature < 35.5 ? "warn" : ""),
            vitalTile("SpO₂", tl.spo2, "%", tl.spo2 < 95 ? "bad" : ""),
            vitalTile("Resp", tl.respiratory_rate, "/min", ""),
            vitalTile("Weight", tl.weight_kg, "kg", ""),
            vitalTile("Height", tl.height_cm, "cm", ""),
            vitalTile("BMI", tl.bmi, tl.bmi_category || "", tl.bmi >= 30 ? "warn" : ""),
            vitalTile("Glucose", tl.blood_glucose, "mmol/L", tl.blood_glucose > 11.1 || tl.blood_glucose < 3.9 ? "warn" : ""),
        ].join("") : "";
        const ta = (name, label, rows = 3, opts = {}) => field(name, label, { type: "textarea", rows, value: c[name], ...opts });

        root.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;gap:16px;flex-wrap:wrap">
                <div><div class="pagehead__eyebrow">${esc(c.consultation_type)} · ${esc(c.name)}</div>
                <h1 class="pagehead__title" style="font-size:30px">${esc(p.full_name)}</h1></div>
                <div style="display:flex;gap:10px;align-items:center">${pill(v.status, "info")}
                    <button class="btn" id="back">← Back to queue</button></div>
            </div>
            ${banner(p, { visit: v.name })}
            ${v.visit_source === "Referral In" ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Referred in from <b>${esc(v.referring_facility || "another facility")}</b>${v.referring_clinician ? " by " + esc(v.referring_clinician) : ""}${v.referral_reason ? " — " + esc(v.referral_reason) : ""}${v.referral_letter ? ` · <a href="${esc(v.referral_letter)}" target="_blank" style="text-decoration:underline">referral letter</a>` : ""}</div>` : ""}
            ${locked ? '<div class="liveinfo ok">This consultation is completed and read-only. You can still print its referrals and certificates.</div>' : ""}
            ${reviewing ? '<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Reviewing investigation results. Use the <b>Review Results</b> tab; everything else on this consultation can still be edited.</div>' : ""}
            <div class="ws">
                <div class="card" id="ws-form">
                    <div class="subtabs" id="subtabs">
                        <button class="subtab on" data-p="bio">Patient Biodata</button>
                        <button class="subtab" data-p="history">History</button>
                        <button class="subtab" data-p="exam">Physical Examination</button>
                        ${medical ? '<button class="subtab" data-p="med">Medical Examination</button>' : ""}
                        <button class="subtab" data-p="dx">Diagnosis <span class="dotc" id="c-dx" style="display:none"></span></button>
                        <button class="subtab" data-p="plan">Plan | Treatment <span class="dotc" id="c-inv" style="display:none"></span></button>
                        <button class="subtab" data-p="rx">Prescriptions <span class="dotc" id="c-rx" style="display:none"></span></button>
                        <button class="subtab" data-p="review">Review Results <span class="dotc" id="c-rev" style="display:none"></span></button>
                    </div>
                    <fieldset id="fs" style="border:0;padding:0;margin:0;min-width:0" ${locked ? "disabled" : ""}>
                    <div class="subpanel on" id="sp-bio">
                        <div class="subhead" style="margin-top:0">Biodata</div>
                        <dl class="bio">
                            ${info("Full name", p.full_name)}${info("Patient no.", p.name)}
                            ${info("Sex", p.sex)}${info("Age", p.age)}${info("Date of birth", p.date_of_birth)}
                            ${info("National ID / Passport", p.national_id)}${info("Phone", p.phone)}${info("Marital status", p.marital_status)}
                            ${info("Occupation", p.occupation)}${info("Residence", p.village)}${isEmp ? info("Staff no.", p.staff_no || p.employee) : ""}
                            ${isEmp ? info("Department", p.department || p.section) : ""}${info("Blood group", p.blood_group)}
                            ${info("Next of kin", [p.next_of_kin, p.next_of_kin_relationship].filter(Boolean).join(" · "))}${info("Next of kin phone", p.next_of_kin_phone)}
                            ${info("Known allergies", p.allergies)}${info("Chronic conditions", p.chronic_conditions)}
                        </dl>
                        <div class="subhead">Triage${t ? ` · ${timeOf(t.triage_datetime)}` : ""} ${t ? `<span class="tag tag--${esc(t.triage_priority)}">${esc(t.triage_priority)}</span>` : ""}</div>
                        ${t ? `<div class="vitals">${vitals}</div>${t.alerts ? `<div class="liveinfo" style="margin:12px 0 0">⚠ ${esc(t.alerts.replace(/\n/g, "; "))}</div>` : ""}
                            ${t.chief_complaint ? `<div class="printnote" style="margin-top:10px">Complaint at triage: ${esc(t.chief_complaint)}</div>` : ""}${t.triage_notes ? `<div class="printnote" style="margin-top:4px">Nurse: ${esc(t.triage_notes)}</div>` : ""}` : empty("No triage recorded for this visit.")}
                    </div>
                    <div class="subpanel" id="sp-history">
                        <div class="subhead" style="margin-top:0">Complaints &amp; symptoms</div>
                        ${ta("presenting_complaint", "Presenting complaints / symptoms", 3)}
                        ${ta("history_of_presenting_illness", "History of presenting illness", 5)}
                        <div class="subhead">Review of other systems</div>
                        <div class="grid-3">
                            ${ta("ros_cns", "CNS", 2, { help: "Headache, dizziness, fits, weakness, numbness" })}
                            ${ta("ros_git", "GIT", 2, { help: "Appetite, nausea, vomiting, abdominal pain, bowel habits" })}
                            ${ta("ros_gut", "GUT", 2, { help: "Dysuria, frequency, haematuria, discharge, LMP" })}
                            ${ta("ros_cvs", "CVS", 2, { help: "Chest pain, palpitations, swelling of feet" })}
                            ${ta("ros_rs", "RS", 2, { help: "Cough, wheeze, shortness of breath" })}
                            ${ta("ros_ms", "MS", 2, { help: "Joint / back pain, swelling, stiffness" })}
                        </div>
                        <div class="subhead">Past history</div>
                        <div class="grid-2">
                            ${ta("past_medical_history", "Past medical history", 3)}
                            ${ta("past_surgical_history", "Past surgical history", 3)}
                            ${ta("current_medication", "Current medication", 2)}
                            ${ta("drug_allergies", "Drug allergies", 2)}
                            ${ta("family_history", "Family history", 2)}
                            ${ta("social_history", "Social history", 2, { help: "Smoking, alcohol…" })}
                            ${isEmp || medical ? ta("occupational_history", "Occupational history", 2, { help: "Farm section, chemicals handled, PPE use, previous employers" }) : ""}
                        </div>
                    </div>
                    <div class="subpanel" id="sp-exam">
                        <div class="subhead" style="margin-top:0">General examination</div>
                        ${ta("exam_general", "Appearance, pallor, jaundice, cyanosis, oedema, lymph nodes, hydration", 4)}
                        <div class="subhead">Systemic examination</div>
                        <div class="grid-2">
                            ${ta("exam_cvs", "Cardiovascular (CVS)", 3)}
                            ${ta("exam_rs", "Respiratory (RS)", 3)}
                            ${ta("exam_abdomen", "Abdomen", 3)}
                            ${ta("exam_cns", "Central nervous system (CNS)", 3)}
                            ${ta("exam_ms", "Musculoskeletal (MS)", 3)}
                            ${ta("exam_other", "Other (ENT, eyes, skin, genito-urinary)", 3)}
                        </div>
                    </div>
                    ${medical ? `<div class="subpanel" id="sp-med">
                        <div class="subhead" style="margin-top:0">${esc(c.consultation_type)}</div>
                        <div class="grid-3">
                            ${field("job_position", c.consultation_type.startsWith("Pre") ? "Position applied for" : "Position held", { value: c.job_position })}
                            ${field("fitness_status", "Fitness outcome", { type: "select", options: FITNESS, value: c.fitness_status, required: true })}
                            ${field("certificate_valid_until", "Valid until", { type: "date", value: c.certificate_valid_until })}
                        </div>
                        ${ta("fitness_restrictions", "Restrictions / conditions", 2, { placeholder: "e.g. No heavy lifting, no pesticide handling" })}
                        <div class="subhead">Examinations done</div>
                        <div id="med-rows"></div>
                        ${locked ? "" : '<div style="margin-top:8px"><button class="btn btn--sm" id="med-add" type="button">+ Add examination</button></div>'}
                        ${ta("medical_remarks", "Examiner's remarks", 3)}
                        <div style="margin-top:14px"><button class="btn btn--signal" id="print-med" type="button">Print medical report</button></div>
                    </div>` : ""}
                    <div class="subpanel" id="sp-dx">
                        ${locked ? "" : `<div class="field"><input class="input" id="dx-add" placeholder="Search or add a diagnosis…"></div>`}
                        <div id="dx-rows"></div>
                        ${isEmp ? field("work_related", "Work-related condition / injury on duty", { type: "checkbox", value: c.work_related }) : ""}
                    </div>
                    <div class="subpanel" id="sp-plan">
                        <div class="subhead" style="margin-top:0">Investigations — referral for labs &amp; imaging</div>
                        <div class="printnote" style="margin-bottom:10px">This clinic has no laboratory or imaging. Request the tests, then print a referral form for the patient to take to the lab or imaging centre.</div>
                        ${locked ? "" : `<div class="field"><input class="input" id="inv-add" placeholder="Search a test or scan to request (e.g. full haemogram, chest x-ray, ultrasound)…"></div>`}
                        <div id="inv-rows"></div>
                        <div class="grid-2" id="inv-fac" style="margin-top:10px">
                            ${field("fac_Laboratory", "Refer labs to (facility)", { value: facFor("Laboratory"), placeholder: "Type to search or add" })}
                            ${field("fac_Imaging", "Refer imaging to (facility)", { value: facFor("Imaging"), placeholder: "Type to search or add" })}
                        </div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 14px">
                            <button class="btn btn--signal" id="print-Laboratory" type="button">Print lab referral</button>
                            <button class="btn btn--signal" id="print-Imaging" type="button">Print imaging referral</button>
                        </div>
                        ${ta("investigations_notes", "Investigation results seen / notes", 3)}
                        <div class="subhead">Treatment</div>
                        ${ta("management_plan", "Management plan", 5)}
                        <div class="grid-2">
                            ${ta("procedures_done", "Procedures done", 3)}
                            ${ta("patient_advice", "Advice given to patient", 3)}
                        </div>
                        <div class="subhead">Referral to another facility</div>
                        ${field("refer_out", "Refer to another facility", { type: "checkbox", value: c.refer_out })}
                        <div id="ref-box" style="display:${c.refer_out ? "block" : "none"}">
                            <div class="grid-2">
                                ${field("referral_facility", "Facility", { value: c.referral_facility, placeholder: "Type to search or add" })}
                                ${field("referral_urgency", "Urgency", { type: "select", options: ["Routine", "Urgent", "Emergency"], value: c.referral_urgency || "Routine" })}
                            </div>
                            ${field("admitted", "Admitted at the referral facility", { type: "checkbox", value: c.admitted })}
                            ${ta("referral_reason", "Reason for referral", 2)}
                            ${ta("referral_notes", "Clinical notes for the receiving facility", 3)}
                        </div>
                        <div class="subhead">Follow-up</div>
                        ${field("follow_up_required", "Book a follow-up appointment", { type: "checkbox", value: c.follow_up_required })}
                        <div id="fu-box" style="display:${c.follow_up_required ? "block" : "none"}">
                            <div class="grid-2">
                                ${field("follow_up_date", "Date", { type: "date", value: c.follow_up_date, attrs: c.appointment ? "disabled" : "" })}
                                ${field("follow_up_reason", "Reason", { value: c.follow_up_reason })}
                            </div>
                            ${c.appointment ? `<div class="printnote">Appointment ${esc(c.appointment)} has been booked.</div>` : ""}
                        </div>
                        ${isEmp ? `<div class="subhead">Employee work status</div><div class="grid-2">
                            ${field("sick_leave_days", "Sick-off days recommended", { type: "number", value: c.sick_leave_days || "", attrs: 'min="0"' })}
                            ${field("light_duty_days", "Light duty days", { type: "number", value: c.light_duty_days || "", attrs: 'min="0"' })}</div>` : ""}
                    </div>
                    <div class="subpanel" id="sp-review">
                        <div class="printnote" style="margin-bottom:12px">Record what came back from the laboratory or imaging centre, then mark each investigation as reviewed. Pressing <b>Save review ✓</b> marks every investigation as reviewed and removes the patient from the “Awaiting Results” list.</div>
                        <div id="rev-rows"></div>
                        ${ta("results_review_notes", "Doctor's review of the results", 4, { placeholder: "Interpretation, decisions made, changes to treatment…" })}
                    </div>
                    <div class="subpanel" id="sp-rx">
                        <div id="rx-allergy"></div>
                        ${locked ? "" : `<div class="field"><input class="input" id="rx-add" placeholder="Search a medicine to prescribe…"></div>`}
                        <div id="rx-rows"></div>
                    </div>
                    </fieldset>
                </div>
                <div class="ws__rail">
                    <div class="card"><div class="card__head" style="margin-bottom:12px"><h3>Patient history</h3><button class="btn btn--link btn--sm" id="tl-all">Show all</button></div>
                        <div class="timeline" id="timeline"></div></div>
                    ${ws.trend.length > 1 ? `<div class="card"><div class="card__head" style="margin-bottom:12px"><h3>Vitals trend</h3></div>
                        <table class="dtable"><tr><th>Date</th><th>BP</th><th class="num">Wt</th></tr>${ws.trend.map((r) => `<tr><td>${esc(dateOf(r.triage_datetime).slice(5))}</td><td>${r.bp_systolic ? r.bp_systolic + "/" + r.bp_diastolic : "—"}</td><td class="num">${r.weight_kg || "—"}</td></tr>`).join("")}</table></div>` : ""}
                </div>
            </div>
            <div class="actionbar"><div><button class="btn" id="save" ${locked ? "disabled" : ""}>Save draft</button> <span class="printnote" id="saved-note"></span></div>
                <div class="actionbar__right" id="actions"></div></div>`;

        bindWorkspace(root, locked, isEmp);
    }

    function facFor(cat) {
        const row = (ws.consultation.investigations || []).find((r) => r.category === cat && r.referred_to);
        return row ? row.referred_to : "";
    }

    function bindWorkspace(root, locked, isEmp) {
        $$(".subtab", root).forEach((b) => b.addEventListener("click", () => {
            $$(".subtab", root).forEach((x) => x.classList.toggle("on", x === b));
            $$(".subpanel", root).forEach((x) => x.classList.toggle("on", x.id === "sp-" + b.dataset.p));
        }));
        $("#back", root).addEventListener("click", async () => {
            if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
            dirty = false;
            history.replaceState(null, "", location.pathname);
            showQueue();
        });
        $("#ws-form", root).addEventListener("input", () => (dirty = true));
        $("#ws-form", root).addEventListener("change", () => (dirty = true));
        $("[data-f=refer_out]", root).addEventListener("change", (e) => ($("#ref-box", root).style.display = e.target.checked ? "block" : "none"));
        $("[data-f=follow_up_required]", root).addEventListener("change", (e) => ($("#fu-box", root).style.display = e.target.checked ? "block" : "none"));

        renderInv(); renderDx(); renderRx(); renderMed(); renderReview();
        renderTimeline(ws.history);
        $("#tl-all", root).addEventListener("click", async () => renderTimeline(await call("consultation.patient_timeline", { patient: ws.patient.name })));
        $("#print-Laboratory", root).addEventListener("click", () => printReferral("Laboratory"));
        $("#print-Imaging", root).addEventListener("click", () => printReferral("Imaging"));
        const pm = $("#print-med", root);
        if (pm) pm.addEventListener("click", async () => {
            if (!locked) await save(false);
            window.open(`/clinic/certificate?consultation=${encodeURIComponent(ws.consultation.name)}`, "_blank");
        });
        refreshActions();

        Desk.facilityField($("[data-f=fac_Laboratory]", root));
        Desk.facilityField($("[data-f=fac_Imaging]", root));
        if (!locked) {
            Desk.facilityField($("[data-f=referral_facility]", root));
            suggest($("#inv-add"), {
                fetch: (q) => M.investigations.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 14),
                render: (t) => ({ main: t.name, sub: t.category }),
                onPick: (t) => { addInv(t); $("#inv-add").value = ""; },
                allowNew: async (name) => {
                    const category = await askCategory(name);
                    if (!category) return null;
                    await call("consultation.add_investigation", { investigation: name, category });
                    const t = { name, category };
                    M.investigations.push(t);
                    return t;
                },
            });
            suggest($("#dx-add"), {
                fetch: (q) => M.diagnoses.filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()) || (d.icd_code || "").toLowerCase().startsWith(q.toLowerCase())).slice(0, 12),
                render: (d) => ({ main: d.name, sub: d.icd_code || d.category }),
                onPick: (d) => { addDx(d.name); $("#dx-add").value = ""; },
                allowNew: async (name) => {
                    await call("consultation.add_diagnosis", { diagnosis: name });
                    const d = { name, icd_code: "", category: "Other" };
                    M.diagnoses.push(d);
                    return d;
                },
            });
            suggest($("#rx-add"), {
                fetch: (q) => call("consultation.search_drugs", { q }, { quiet: true }),
                render: (i) => ({ main: i.item_name, sub: i.available > 0 ? `${i.available} ${i.stock_uom} in stock` : "Out of stock" }),
                onPick: (i) => {
                    if (!(i.available > 0)) return toast(`${i.item_name} is out of stock at the pharmacy`, "warn");
                    addRx(i); $("#rx-add").value = "";
                },
                allowNew: async (name) => {
                    const item = await call("consultation.add_drug", { drug_name: name });
                    toast(`${item.item_name} added to the medicine list`);
                    return item;
                },
            });
            const add = $("#med-add", root);
            if (add) add.addEventListener("click", () => { state.med.push({ test: "", result: "", findings: "" }); dirty = true; renderMed(); });
        }
        $("#save", root).addEventListener("click", () => save(true));
    }

    function askCategory(name) {
        return new Promise((resolve) => modal({
            title: "New investigation",
            sub: `Add “${esc(name)}” to the list`,
            body: '<p style="margin:0;color:var(--ink-3)">Is it a laboratory test or an imaging study?</p>',
            foot: [
                { label: "Cancel", onClick: (hh) => { resolve(null); hh.close(); } },
                { label: "Laboratory", cls: "btn--primary", onClick: (hh) => { resolve("Laboratory"); hh.close(); } },
                { label: "Imaging", cls: "btn--primary", onClick: (hh) => { resolve("Imaging"); hh.close(); } },
            ],
            onClose: () => resolve(null),
        }));
    }

    async function printReferral(category) {
        if (!state.inv.some((r) => (r.category || catOf(r.investigation)) === category)) return toast(`No ${category.toLowerCase()} investigations have been requested`, "warn");
        if (!locked()) await save(false);
        window.open(`/clinic/referral?consultation=${encodeURIComponent(ws.consultation.name)}&type=${category}`, "_blank");
    }
    const catOf = (name) => (M.investigations.find((t) => t.name === name) || {}).category || "Laboratory";

    // ---- investigations
    function addInv(t) {
        if (state.inv.some((r) => r.investigation === t.name)) return toast(`${t.name} is already requested`, "warn");
        state.inv.push({ investigation: t.name, category: t.category, urgency: "Routine", clinical_notes: "", result_status: "Awaiting Results" });
        dirty = true; renderInv(); renderReview();
    }
    function renderInv() {
        const el = $("#inv-rows");
        el.innerHTML = state.inv.length ? state.inv.map((r, i) => `<div class="linebox"><div class="linebox__row">
            <div><b style="color:var(--ink)">${esc(r.investigation)}</b> ${pill(r.category || catOf(r.investigation), (r.category || catOf(r.investigation)) === "Imaging" ? "info" : "mute")}</div>
            <div style="display:flex;gap:10px;align-items:center">
                <select class="input" style="width:110px;padding:6px 10px" data-inv="${i}" data-k="urgency">${["Routine", "Urgent"].map((u) => `<option ${u === r.urgency ? "selected" : ""}>${u}</option>`).join("")}</select>
                <button class="iconx" data-inv-del="${i}" title="Remove">×</button></div></div>
            <input class="input" style="margin-top:10px" placeholder="Clinical notes / reason for the test (optional)" data-inv="${i}" data-k="clinical_notes" value="${esc(r.clinical_notes || "")}"></div>`).join("") : empty("No investigations requested.");
        $$("[data-inv]", el).forEach((inp) => inp.addEventListener("input", () => (state.inv[inp.dataset.inv][inp.dataset.k] = inp.value)));
        $$("[data-inv-del]", el).forEach((b) => b.addEventListener("click", () => { state.inv.splice(Number(b.dataset.invDel), 1); dirty = true; renderInv(); renderReview(); }));
        const n = state.inv.length; $("#c-inv").style.display = n ? "" : "none"; $("#c-inv").textContent = n;
        if (locked()) $$("#inv-rows input,#inv-rows select,#inv-rows button").forEach((x) => (x.disabled = true));
    }

    // ---- review of investigation results
    const RES_STATUS = ["Awaiting Results", "Results Received", "Reviewed"];
    function renderReview() {
        const el = $("#rev-rows");
        const pendingCount = state.inv.filter((r) => (r.result_status || "Awaiting Results") !== "Reviewed").length;
        const dot = $("#c-rev"); dot.style.display = pendingCount ? "" : "none"; dot.textContent = pendingCount;
        el.innerHTML = state.inv.length ? state.inv.map((r, i) => {
            const st = r.result_status || "Awaiting Results";
            const flagCls = { Normal: "good", Abnormal: "bad", Critical: "bad" }[r.result_flag] || "mute";
            return `<div class="linebox"><div class="linebox__row">
                <div><b style="color:var(--ink)">${esc(r.investigation)}</b> ${pill(r.category || catOf(r.investigation), (r.category || catOf(r.investigation)) === "Imaging" ? "info" : "mute")}
                    ${r.result_flag ? pill(r.result_flag, flagCls) : ""}</div>
                <select class="input" style="width:170px;padding:6px 10px" data-rev="${i}" data-k="result_status">${RES_STATUS.map((o) => `<option ${o === st ? "selected" : ""}>${o}</option>`).join("")}</select></div>
                <div class="grid-3" style="margin-top:10px">
                    <div class="field"><label>Result date</label><input type="date" data-rev="${i}" data-k="result_date" value="${esc(r.result_date || "")}"></div>
                    <div class="field"><label>Result</label><select data-rev="${i}" data-k="result_flag">${["", "Normal", "Abnormal", "Critical"].map((o) => `<option ${o === (r.result_flag || "") ? "selected" : ""}>${o}</option>`).join("")}</select></div>
                    <div class="field"><label>Report / image</label>
                        ${r.result_attachment ? `<div><a href="${esc(r.result_attachment)}" target="_blank" class="btn btn--sm">Open report</a> <button class="btn btn--link btn--sm" data-rev-clear="${i}" type="button">Remove</button></div>`
                            : `<input type="file" data-rev-file="${i}" accept="image/*,application/pdf">`}</div>
                </div>
                <div class="grid-2">
                    <div class="field"><label>${(r.category || catOf(r.investigation)) === "Imaging" ? "Findings" : "Values / findings"}</label><textarea rows="3" data-rev="${i}" data-k="result_findings" placeholder="${(r.category || catOf(r.investigation)) === "Imaging" ? "Radiologist's findings" : "e.g. Hb 13.2 g/dL, WBC 7.1"}">${esc(r.result_findings || "")}</textarea></div>
                    <div class="field"><label>Impression / interpretation</label><textarea rows="3" data-rev="${i}" data-k="result_impression">${esc(r.result_impression || "")}</textarea></div>
                </div></div>`;
        }).join("") : empty("No investigations were requested on this consultation.");
        $$("[data-rev]", el).forEach((inp) => inp.addEventListener("change", () => {
            const row = state.inv[inp.dataset.rev], k = inp.dataset.k;
            row[k] = inp.value;
            if (k === "result_flag" && inp.value && row.result_status === "Awaiting Results") row.result_status = "Results Received";
            if (k === "result_status" && inp.value !== "Awaiting Results" && !row.result_date) row.result_date = new Date().toISOString().slice(0, 10);
            dirty = true; renderReview();
        }));
        $$("[data-rev-clear]", el).forEach((b) => b.addEventListener("click", () => { state.inv[b.dataset.revClear].result_attachment = ""; dirty = true; renderReview(); }));
        $$("[data-rev-file]", el).forEach((inp) => inp.addEventListener("change", async () => {
            const file = inp.files[0]; if (!file) return;
            const fd = new FormData(); fd.append("file", file, file.name); fd.append("is_private", "1");
            try {
                const res = await fetch("/api/method/upload_file", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-Frappe-CSRF-Token": Desk.cfg.csrf } });
                const data = await res.json();
                if (!res.ok) throw new Error("upload failed");
                const row = state.inv[inp.dataset.revFile];
                row.result_attachment = data.message.file_url;
                if (row.result_status === "Awaiting Results") row.result_status = "Results Received";
                if (!row.result_date) row.result_date = new Date().toISOString().slice(0, 10);
                dirty = true; renderReview(); toast("Report uploaded");
            } catch (e) { toast("The report could not be uploaded", "error"); }
        }));
        if (locked()) $$("#rev-rows input,#rev-rows select,#rev-rows textarea,#rev-rows button").forEach((x) => (x.disabled = true));
    }

    // ---- employment medical examinations
    function renderMed() {
        const el = $("#med-rows");
        if (!el) return;
        el.innerHTML = state.med.length ? `<table class="rtable"><tr><th>Examination</th><th style="width:150px">Result</th><th>Findings</th><th style="width:34px"></th></tr>
            ${state.med.map((r, i) => `<tr><td><input class="input" data-med="${i}" data-k="test" value="${esc(r.test || "")}"></td>
                <td><select class="input" data-med="${i}" data-k="result">${["", "Normal", "Abnormal", "Not Done"].map((o) => `<option ${o === (r.result || "") ? "selected" : ""}>${o}</option>`).join("")}</select></td>
                <td><input class="input" data-med="${i}" data-k="findings" value="${esc(r.findings || "")}"></td>
                <td><button class="iconx" data-med-del="${i}" title="Remove" type="button">×</button></td></tr>`).join("")}</table>` : empty("No examinations listed.");
        $$("[data-med]", el).forEach((inp) => inp.addEventListener("input", () => (state.med[inp.dataset.med][inp.dataset.k] = inp.value)));
        $$("[data-med-del]", el).forEach((b) => b.addEventListener("click", () => { state.med.splice(Number(b.dataset.medDel), 1); dirty = true; renderMed(); }));
        if (locked()) $$("#med-rows input,#med-rows select,#med-rows button").forEach((x) => (x.disabled = true));
    }

    // ---- diagnoses
    function addDx(name) {
        if (state.dx.some((r) => r.diagnosis === name)) return toast(`${name} is already listed`, "warn");
        state.dx.push({ diagnosis: name, diagnosis_type: state.dx.length ? "Provisional" : "Provisional", notes: "" });
        dirty = true; renderDx();
    }
    function renderDx() {
        const info = Object.fromEntries(M.diagnoses.map((d) => [d.name, d]));
        const el = $("#dx-rows");
        el.innerHTML = state.dx.length ? state.dx.map((r, i) => `<div class="linebox"><div class="linebox__row">
            <div><b style="color:var(--ink)">${esc(r.diagnosis)}</b> <span class="printnote">${esc((info[r.diagnosis] || {}).icd_code || "")}</span>
                ${(info[r.diagnosis] || {}).is_occupational ? pill("Occupational", "warn") : ""}</div>
            <div style="display:flex;gap:10px;align-items:center">
                <select class="input" style="width:130px;padding:6px 10px" data-dx="${i}" data-k="diagnosis_type">${["Provisional", "Confirmed"].map((u) => `<option ${u === r.diagnosis_type ? "selected" : ""}>${u}</option>`).join("")}</select>
                <button class="iconx" data-dx-del="${i}" title="Remove">×</button></div></div>
            <input class="input" style="margin-top:10px" placeholder="Notes (optional)" data-dx="${i}" data-k="notes" value="${esc(r.notes || "")}"></div>`).join("") : empty("No diagnosis added yet.");
        $$("[data-dx]", el).forEach((inp) => inp.addEventListener("input", () => (state.dx[inp.dataset.dx][inp.dataset.k] = inp.value)));
        $$("[data-dx-del]", el).forEach((b) => b.addEventListener("click", () => { state.dx.splice(Number(b.dataset.dxDel), 1); dirty = true; renderDx(); }));
        const n = state.dx.length; $("#c-dx").style.display = n ? "" : "none"; $("#c-dx").textContent = n;
        if (locked()) $$("#dx-rows input,#dx-rows select,#dx-rows button").forEach((x) => (x.disabled = true));
    }

    // ---- prescriptions
    function addRx(item) {
        state.rx.push({ drug: item.name, drug_name: item.item_name, available: item.available, dose: "", route: "Oral", frequency: "", duration_days: "", quantity: "", instructions: "" });
        dirty = true; renderRx(); refreshActions();
    }
    function autoQty(i) {
        const r = state.rx[i], per = FREQ[String(r.frequency || "").trim().toLowerCase()];
        if (per && Number(r.duration_days) > 0 && !r._qtyTouched) {
            r.quantity = per * Number(r.duration_days);
            const q = $(`[data-rx="${i}"][data-k="quantity"]`);
            if (q) q.value = r.quantity;
        }
    }
    function renderRx() {
        const allergies = [ws.patient.allergies, read($("#ws-form"))?.drug_allergies].filter(Boolean)[0];
        $("#rx-allergy").innerHTML = allergies ? `<div class="liveinfo" style="background:var(--bad-bg);color:var(--bad)">⚠ Allergies on record: ${esc(allergies)}</div>` : "";
        const el = $("#rx-rows");
        const routes = ["Oral", "IM", "IV", "Topical", "Rectal", "Inhalation", "Eye/Ear Drops", "Other"];
        el.innerHTML = state.rx.length ? state.rx.map((r, i) => `<div class="linebox">
            <div class="linebox__row" style="margin-bottom:10px"><b style="color:var(--ink)">${esc(r.drug_name || r.drug)}</b><button class="iconx" data-rx-del="${i}" title="Remove">×</button></div>
            <div class="grid-4">
                <div class="field"><label>Dose</label><input data-rx="${i}" data-k="dose" value="${esc(r.dose || "")}" placeholder="500 mg"></div>
                <div class="field"><label>Route</label><select data-rx="${i}" data-k="route">${routes.map((o) => `<option ${o === r.route ? "selected" : ""}>${o}</option>`).join("")}</select></div>
                <div class="field"><label>Frequency</label><input data-rx="${i}" data-k="frequency" value="${esc(r.frequency || "")}" placeholder="BD / TDS"></div>
                <div class="field"><label>Days</label><input type="number" min="1" data-rx="${i}" data-k="duration_days" value="${esc(r.duration_days ?? "")}"></div>
            </div>
            <div class="grid-4">
                <div class="field"><label>Quantity <span class="req">*</span></label><input type="number" min="0" step="any" ${r.available != null ? `max="${r.available}"` : ""} data-rx="${i}" data-k="quantity" value="${esc(r.quantity ?? "")}">${r.available != null ? `<small>${r.available} in stock</small>` : ""}</div>
                <div class="field" style="grid-column:span 3"><label>Instructions</label><input data-rx="${i}" data-k="instructions" value="${esc(r.instructions || "")}" placeholder="After meals, finish the course…"></div>
            </div></div>`).join("") : empty("No medication prescribed. Complete the consultation without pharmacy if none is needed.");
        $$("[data-rx]", el).forEach((inp) => inp.addEventListener("input", () => {
            const i = Number(inp.dataset.rx), k = inp.dataset.k;
            state.rx[i][k] = inp.value;
            if (k === "quantity") state.rx[i]._qtyTouched = true;
            if (k === "frequency" || k === "duration_days") autoQty(i);
        }));
        $$("[data-rx-del]", el).forEach((b) => b.addEventListener("click", () => { state.rx.splice(Number(b.dataset.rxDel), 1); dirty = true; renderRx(); refreshActions(); }));
        const n = state.rx.length; $("#c-rx").style.display = n ? "" : "none"; $("#c-rx").textContent = n;
        if (locked()) $$("#rx-rows input,#rx-rows select,#rx-rows button").forEach((x) => (x.disabled = true));
    }

    const locked = () => !!ws.locked;

    // ---- timeline
    function renderTimeline(rows) {
        const el = $("#timeline");
        el.innerHTML = rows.length ? rows.map((h, i) => `<div class="tl" data-tl="${i}">
            <div class="tl__date">${esc(dateOf(h.consultation_date))} · ${esc(h.doctor_name || "")}</div>
            <div class="tl__dx">${h.diagnoses.length ? h.diagnoses.map((d) => esc(d.diagnosis)).join(", ") : "<i>No diagnosis</i>"}</div>
            <div class="printnote">${esc(h.presenting_complaint || "")}</div>
            <div class="tl__detail">
                ${h.management_plan ? `<div><b>Management:</b> ${esc(h.management_plan)}</div>` : ""}
                ${h.prescriptions.length ? `<div><b>Prescribed:</b> ${h.prescriptions.map((x) => esc(x.drug_name || x.drug) + (x.dose ? " " + esc(x.dose) : "") + (x.frequency ? " " + esc(x.frequency) : "") + (x.duration_days ? " × " + x.duration_days + "d" : "")).join("; ")}</div>` : ""}
                ${h.consultation_type && h.consultation_type !== "Consultation" ? `<div><b>${esc(h.consultation_type)}:</b> ${esc(h.fitness_status || "—")}</div>` : ""}
                ${h.refer_out ? `<div><b>Referred to:</b> ${esc(h.referral_facility || "")}</div>` : ""}
                ${h.sick_leave_days ? `<div><b>Sick-off:</b> ${h.sick_leave_days} days</div>` : ""}
                ${h.work_related ? `<div><b>Work-related</b></div>` : ""}
            </div></div>`).join("") : empty("First visit — no earlier consultations.");
        $$(".tl", el).forEach((t) => t.addEventListener("click", () => t.classList.toggle("open")));
    }

    // ---- actions
    function refreshActions() {
        const box = $("#actions");
        if (locked()) { box.innerHTML = ""; return; }
        const done = ws.consultation.status === "Completed"; // reviewing results
        const hasRx = state.rx.length > 0;
        const canSend = hasRx && (!done || !ws.consultation.dispensing);
        box.innerHTML = done
            ? `${canSend ? '<button class="btn" id="a-rx">Send to Pharmacy →</button>' : ""}<button class="btn btn--primary" id="a-review">Save review ✓</button>`
            : hasRx
                ? '<button class="btn btn--primary" id="a-rx">Send to Pharmacy →</button>'
                : '<button class="btn btn--primary" id="a-done">Complete consultation ✓</button>';
        $("#a-rx")?.addEventListener("click", () => act("send_to_pharmacy", "Sent to the pharmacy"));
        $("#a-done")?.addEventListener("click", () => act("complete", "Consultation completed"));
        $("#a-review")?.addEventListener("click", async () => {
            const btn = $("#a-review"); btn.disabled = true;
            // saving the review closes it: every investigation moves to Reviewed
            const today = new Date().toISOString().slice(0, 10);
            state.inv.forEach((r) => { r.result_status = "Reviewed"; if (!r.result_date && (r.result_findings || r.result_impression || r.result_flag || r.result_attachment)) r.result_date = today; });
            try { await save(false); toast("Review saved. Results marked as reviewed."); history.replaceState(null, "", location.pathname); showQueue(); }
            catch (e) { btn.disabled = false; }
        });
    }

    function collect() {
        const form = $("#ws-form");
        const data = read(form);
        // unchecked/absent boxes come through as 0; empty date strings are cleaned server side
        const fac = { Laboratory: data.fac_Laboratory || null, Imaging: data.fac_Imaging || null };
        delete data.fac_Laboratory; delete data.fac_Imaging;
        data.investigations = state.inv.map(({ investigation, category, urgency, clinical_notes, result_status, result_date, result_flag, result_findings, result_impression, result_attachment }) => ({
            investigation, urgency, clinical_notes, referred_to: fac[category || catOf(investigation)],
            result_status, result_date, result_flag, result_findings, result_impression, result_attachment,
        }));
        data.diagnoses = state.dx.map(({ diagnosis, diagnosis_type, notes }) => ({ diagnosis, diagnosis_type, notes }));
        data.prescriptions = state.rx.map(({ drug, dose, route, frequency, duration_days, quantity, instructions }) => ({ drug, dose, route, frequency, duration_days, quantity, instructions }));
        if (isMedical()) data.medical_tests = state.med.map(({ test, result, findings }) => ({ test, result, findings }));
        return data;
    }

    async function save(showToast) {
        await call("consultation.save", { name: ws.consultation.name, data: collect() });
        dirty = false;
        $("#saved-note").textContent = "Saved " + new Date().toTimeString().slice(0, 5);
        if (showToast) toast("Draft saved");
    }

    async function act(action, message) {
        if (isMedical() && !read($("#ws-form")).fitness_status) {
            toast("Record the fitness outcome on the Medical Examination tab first", "warn");
            const tab = $(".subtab[data-p=med]"); if (tab) tab.click();
            return;
        }
        const btns = $$(".actionbar button"); btns.forEach((b) => (b.disabled = true));
        try {
            await call("consultation.action", { name: ws.consultation.name, action, data: collect() });
            dirty = false;
            toast(message);
            history.replaceState(null, "", location.pathname);
            showQueue();
        } catch (e) {
            btns.forEach((b) => (b.disabled = false));
        }
    }

    // ============================================================ start
    const start = location.hash.replace("#/", "");
    if (start) { try { await openVisit(start); } catch (e) { showQueue(); } }
    else await loadAll();
    Desk.poll(() => { if ($("#view-ws").style.display === "none") loadAll(); });
})();
