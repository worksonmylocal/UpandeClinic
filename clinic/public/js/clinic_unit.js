/* Clinic desks: Antenatal, MCH & Postnatal and TB clinics share this script (window.UNIT picks the clinic) */
(async function () {
    const { call, $, $$, esc, money, timeOf, dateOf, wait, typeTag, pill, ageSex, empty, split, toast, kpis, hbars, chart, modal, field, read, suggest, banner, masters, COLORS } = Desk;
    const UNIT = window.UNIT;

    const SEL = (arr) => arr.map((v) => ({ value: v, label: v || "—" }));
    const YN = "checkbox";
    // Clinic-specific fields, by service. [fieldname, label, type, options/attrs]
    const SERVICE_FIELDS = {
        // Family planning is drawn by fp.js (register sections 1-4)
        "Family Planning": [],
        // ANC attendance is drawn by anc.js (register sections 1-7)
        "ANC Attendance": [],
        // Postnatal attendance is drawn by pnc.js (register sections 1-10)
        "Postnatal Attendance": [],
        // HIV testing is drawn by hts.js
        "HTS Attendance": [],
        // CWC attendance is drawn by cwc.js (register sections 1-4)
        "CWC Attendance": [],
    };
    const TB_FIELDS = [
        ["tb_registration_no", "TB registration no.", "text"], ["tb_type", "TB type", "select", ["", "Pulmonary", "Extra-pulmonary"]],
        ["tb_category", "Patient category", "select", ["", "New", "Relapse", "Treatment after failure", "Treatment after loss to follow-up", "Transfer in"]],
        ["treatment_phase", "Treatment phase", "select", ["", "Intensive", "Continuation"]],
        ["regimen", "Regimen", "text"], ["treatment_start_date", "Treatment start date", "date"],
        ["weeks_on_treatment", "Weeks on treatment", "readonly"], ["adherence", "Adherence", "select", ["", "Good", "Fair", "Poor"]],
        ["dot_supporter", "DOT supporter", "text"], ["latest_sputum_result", "Latest sputum result", "text"],
        ["side_effects", "Side effects", "textarea"],
    ];
    SERVICE_FIELDS["TB Registration"] = TB_FIELDS;
    SERVICE_FIELDS["TB Follow-up"] = TB_FIELDS;
    const CFG = {
        antenatal: { title: "Antenatal Clinic", tag: "Family Planning & Antenatal", sub: "Family planning (FP) and antenatal clinic attendances", tiles: { "Family Planning": "Family Planning", "ANC Attendance": "ANC Attendances" } },
        mch: { title: "MCH & Postnatal", tag: "Mother & Child Health", sub: "Child welfare clinic (CWC) and postnatal attendances", tiles: { "Postnatal Attendance": "Postnatal", "CWC Attendance": "CWC Attendances" } },
        tb: { title: "TB Clinic", tag: "Tuberculosis Clinic", sub: "TB registration, follow-up and treatment monitoring", tiles: { "TB Registration": "New Registrations", "TB Follow-up": "Follow-ups" } },
        hts: { title: "HTS Clinic", tag: "HIV Testing Services", sub: "Walk-in HIV testing, counselling and prevention", tiles: { "HTS Attendance": "HTS Clients" } },
    }[UNIT];
    const isHts = UNIT === "hts";

    await Desk.shell({
        page: UNIT,
        eyebrow: "Northlake Medical Centre · " + CFG.tag,
        title: CFG.title,
        sub: CFG.sub,
        tools: `${isHts ? '<button class="btn btn--primary" id="hts-new">+ New HTS client</button> ' : ""}<button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => { if (tab === "insights") loadInsights(); else if (tab === "month") loadMonth(); else if (tab === "defaulters") loadDefaulters(); });
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });
    // clients walk straight into the HTS clinic: find or register them here, then open their attendance
    if (isHts) $("#hts-new").addEventListener("click", () => Desk.pickPatient({
        title: "Find or register the client",
        onPick: async (p) => { const r = await call("hts.start_client", { patient: p.name }); toast(r.resumed ? "Continuing the open attendance" : "HTS attendance opened"); openVisit(r.visit); },
    }));
    const api = (method, args = {}) => call("clinic_unit." + method, { unit: UNIT, ...args });

    const M = await masters();
    let dash, ws, state, dirty = false;

    // ============================================================ queue
    async function loadAll() {
        dash = await api("dashboard");
        renderKpis(dash);
        renderQueues(dash);
        renderCompleted(dash.completed);
        if ($("#tab-insights").classList.contains("on")) loadInsights();
        if ($("#tab-month").classList.contains("on")) loadMonth();
    }

    function renderKpis(d) {
        const k = d.kpis, names = Object.keys(CFG.tiles);
        if (isHts) {
            const h = d.hts || { positive: 0, negative: 0, inconclusive: 0 };
            return kpis($("#kpis"), [
                { label: "Open Attendances", value: k.in_progress, cls: k.in_progress ? "warn" : "", unit: "Clients being attended" },
                { label: "Seen Today", value: k.seen_today, cls: "good", unit: split(k.employees_today, k.community_today) },
                { label: "Tested Negative", value: h.negative, cls: "good", unit: "Today" },
                { label: "Tested Positive", value: h.positive, cls: h.positive ? "bad" : "", unit: "Today" },
                { label: "Inconclusive", value: h.inconclusive, cls: h.inconclusive ? "warn" : "", unit: "Needs retesting" },
            ]);
        }
        kpis($("#kpis"), [
            { label: "Waiting for the Clinic", value: k.waiting, cls: k.waiting ? "warn" : "", unit: k.emergency ? `${k.emergency} urgent / emergency` : k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "Queue is clear" },
            { label: "Lab Results Ready", value: k.results_ready, cls: k.results_ready ? "info" : "", unit: "Awaiting your review" },
            { label: "Seen Today", value: k.seen_today, cls: "good", unit: `${split(k.employees_today, k.community_today)}${k.to_doctor ? " · " + k.to_doctor + " to doctor" : ""}` },
            { label: CFG.tiles[names[0]], value: k.by_service[names[0]] || 0, unit: "Today" },
            { label: CFG.tiles[names[1]], value: k.by_service[names[1]] || 0, unit: "Today" },
            { label: "Presumed TB Today", value: k.presumed_tb, cls: k.presumed_tb ? "bad" : "", unit: `TB screening code 1 · avg wait ${Desk.duration(k.avg_wait)}` },
            ...(d.cwc ? [{ label: "Immunization Defaulters", value: d.cwc.defaulters, cls: d.cwc.defaulters ? "bad" : "good",
                unit: `${d.cwc.registered} children in the register · ${d.cwc.due_soon} due soon` }] : []),
        ]);
        if (d.cwc) {
            const badge = $("#def-badge");
            if (badge) { badge.style.display = d.cwc.defaulters ? "" : "none"; badge.textContent = d.cwc.defaulters; }
            $$(".kpi").forEach((tile) => {
                if (!tile.textContent.includes("Immunization Defaulters")) return;
                tile.style.cursor = "pointer";
                tile.title = "Show the children to follow up";
                tile.addEventListener("click", () => $(".tab[data-tab=defaulters]").click());
            });
        }
    }

    const referralLine = (v) => (v.visit_source === "Referral In"
        ? `Referred in from <b>${esc(v.referring_facility || "another facility")}</b>${v.referring_clinician ? " by " + esc(v.referring_clinician) : ""}${v.referral_reason ? " — " + esc(v.referral_reason) : ""}` : "");

    function queueCard(r, button, extra = "") {
        return `<div class="qcard"><div class="qcard__stripe ${esc(r.priority || "")}"></div>
            <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                ${r.priority ? `<span class="tag tag--${esc(r.priority)}">${esc(r.priority)}</span>` : ""}</div>
            <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}${r.department ? " · " + esc(r.department) : ""}</div>
            ${r.visit_source === "Referral In" ? `<div class="qcard__note" style="color:var(--info)">⇥ ${referralLine(r)}</div>` : ""}
            ${r.chief_complaint ? `<div class="qcard__note">${esc(r.chief_complaint)}</div>` : ""}
            ${r.alerts ? `<div class="qcard__note alert">⚠ ${esc(r.alerts.replace(/\n/g, "; "))}</div>` : ""}${extra}</div>
            <div class="qcard__side">${r.wait_minutes != null ? wait(r.wait_minutes, 20, 45) : ""}${button}</div></div>`;
    }

    function renderQueues(d) {
        // the HTS desk has no triage queue, lab or pharmacy: its page only has the open attendances
        const put = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
        const meta = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
        meta("#waiting-meta", d.waiting.length ? `${d.waiting.length} waiting` : "");
        put("#waiting", d.waiting.length
            ? d.waiting.map((r) => queueCard(r, `<button class="btn btn--primary btn--sm" data-open="${esc(r.visit)}">Attend</button>`)).join("")
            : empty("No patients waiting."));
        meta("#ready-meta", d.results_ready.length ? `${d.results_ready.length} to review` : "");
        put("#ready", d.results_ready.length
            ? d.results_ready.map((r) => queueCard(r, `<button class="btn btn--signal btn--sm" data-open="${esc(r.visit)}">Review results</button>`,
                `<div class="qcard__note">${r.tests.map((t) => `${esc(t.test_type)}: <b style="color:${["Positive", "Abnormal"].includes(t.interpretation) ? "var(--bad)" : "var(--good)"}">${esc(t.interpretation || t.status)}</b>`).join(" · ")}</div>`)).join("")
            : empty("No lab results waiting."));
        $("#progress").innerHTML = d.in_progress.length
            ? d.in_progress.map((r) => queueCard(r, `<button class="btn btn--sm" data-open="${esc(r.visit)}">Continue</button>`)).join("")
            : empty("None open.");
        put("#flight", d.in_flight.length
            ? d.in_flight.map((r) => `<div class="qcard"><div class="qcard__stripe"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}</div><div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}</div></div>
                <div class="qcard__side">${pill(r.status, r.status === "Waiting Lab" ? "info" : "warn")}<button class="btn btn--link btn--sm" data-open="${esc(r.visit)}">Open</button></div></div>`).join("")
            : empty("No one at the lab or pharmacy."));
        $$("[data-open]").forEach((b) => b.addEventListener("click", () => openVisit(b.dataset.open)));
    }

    const attRows = (rows) => rows.map((r) => `<tr><td>${esc(dateOf(r.attendance_date).slice(5))} ${timeOf(r.attendance_date)}</td>
        <td><b style="color:var(--ink)">${esc(r.patient_name)}</b><br><span class="printnote">${esc(ageSex(r))}</span></td><td>${typeTag(r.patient_type)}</td>
        <td>${esc(r.service_type)}</td><td>${isHts ? (r.hts_final_result ? pill(r.hts_final_result, r.hts_final_result === "Positive" ? "bad" : r.hts_final_result === "Negative" ? "good" : "warn") : "—") : (r.tb_screening ? pill(r.tb_screening, r.tb_screening.startsWith("1") ? "bad" : "mute") : "—")}</td>
        <td>${r.referred_to_doctor ? pill("Sent to doctor", "warn") : pill("Completed", "good")}</td></tr>`).join("");
    const attHead = `<tr><th>When</th><th>Patient</th><th>Type</th><th>Service</th><th>${isHts ? "HIV test outcome" : "TB screening"}</th><th>Outcome</th></tr>`;

    function renderCompleted(rows) {
        $("#completed").innerHTML = rows.length ? `<table class="dtable">${attHead}${attRows(rows)}</table>` : empty("No completed attendances yet today.");
    }

    async function loadMonth() {
        const d = await api("seen_month"), s = d.summary, names = Object.keys(CFG.tiles);
        $("#month-meta").textContent = d.month;
        kpis($("#month-kpis"), isHts ? [
            { label: "Seen This Month", value: s.total, cls: "good", unit: d.month },
            { label: "Employees / Community", value: `${s.employees} <span style="font-size:14px;color:var(--ink-mute)">/ ${s.community}</span>`, unit: "Clients tested" },
        ] : [
            { label: "Seen This Month", value: s.total, cls: "good", unit: d.month },
            { label: "Employees / Community", value: `${s.employees} <span style="font-size:14px;color:var(--ink-mute)">/ ${s.community}</span>`, unit: "Patients attended" },
            { label: CFG.tiles[names[0]], value: s.by_service[names[0]] || 0, unit: "This month" },
            { label: CFG.tiles[names[1]], value: s.by_service[names[1]] || 0, unit: "This month" },
            { label: "Presumed TB", value: s.presumed_tb, cls: s.presumed_tb ? "bad" : "", unit: `${s.to_doctor} sent to doctor` },
        ]);
        $("#seen-month").innerHTML = d.rows.length ? `<table class="dtable">${attHead}${attRows(d.rows)}</table>` : empty("No completed attendances yet this month.");
    }

    async function loadDefaulters() {
        const [rows, soon] = await Promise.all([CWC.api("defaulters"), CWC.api("due_soon", { days: 14 })]);
        $("#def-meta").textContent = rows.length ? `${rows.length} to follow up` : "";
        CWC.renderDefaulters($("#defaulters"), rows);
        $("#soon-meta").textContent = soon.length ? `${soon.length} children` : "";
        $("#due-soon").innerHTML = soon.length ? `<table class="dtable"><tr><th>Due</th><th>Child</th><th>CWC No.</th><th>Vaccines</th><th>Guardian</th></tr>
            ${soon.map((r) => `<tr><td>${esc(dateOf(r.due_date))}</td><td><b style="color:var(--ink)">${esc(r.child_name)}</b></td><td>${esc(r.cwc_no)}</td>
                <td>${esc(r.vaccines)}</td><td>${esc(r.caregiver_name || "")}<br><span class="printnote">${esc(r.caregiver_phone || "")}</span></td></tr>`).join("")}</table>`
            : empty("Nothing falls due in the next fortnight.");
    }

    async function loadInsights() {
        const d = await api("insights");
        if (isHts) {   // the second chart shows the HIV test outcomes, not TB screening
            const card = $("#tb-screen").closest(".card");
            card.querySelector("h3").textContent = "HIV Test Outcomes — Last 30 Days";
            const meta = card.querySelector(".meta"); if (meta) meta.textContent = "";
        }
        chart("day-chart", { type: "bar", data: { labels: d.by_day.map((r) => r.day.slice(5)), datasets: Desk.stackedDatasets(d.by_day) }, options: { ...Desk.stackedOptions, plugins: { legend: { display: false } } } });
        hbars($("#services"), d.services);
        hbars($("#tb-screen"), d.tb_screening, { cls: (r) => (r.label.startsWith("1") && r.value ? "bad" : "") });
        $("#specific-title").textContent = d.specific_title;
        hbars($("#specific"), d.specific);
    }

    // ============================================================ routing
    async function openVisit(visit) {
        let data = await api("workspace", { visit });
        if (!data.attendance) {
            const service = await pickService(data);
            if (!service) return;
            await api("start", { visit, service_type: service });
            data = await api("workspace", { visit });
        }
        renderWorkspace(data);
        location.hash = "#/" + visit;
    }

    function pickService(data) {
        return new Promise((resolve) => {
            const h = modal({
                title: `Attend ${data.patient.full_name}`,
                sub: "What is the patient here for?",
                body: `${banner(data.patient)}<div class="chipbox" style="gap:12px">${data.services.map((s) => `<button class="btn btn--primary" data-svc="${esc(s)}" style="padding:14px 24px">${esc(s)}</button>`).join("")}</div>`,
                foot: [{ label: "Cancel", onClick: (hh) => { hh.close(); resolve(null); } }],
                onClose: () => resolve(null),
            });
            $$("[data-svc]", h.body).forEach((b) => b.addEventListener("click", () => { const s = b.dataset.svc; resolve(s); h.close(); }));
        });
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
    const vitalTile = (label, value, unit, level) => (!value ? "" : `<div class="vital ${level || ""}"><small>${label}</small><b>${esc(value)}</b><em>${unit}</em></div>`);
    const TB_OPTIONS = [[1, "Presumed TB"], [2, "No Signs"], [3, "On TB Treatment"], [4, "Not Done"]];
    const locked = () => ws.attendance.status === "Completed";

    function tbBar(current, isLocked) {
        const code = current ? Number(String(current)[0]) : 0;
        return `<div class="tbbar ${code ? "" : "required"}" id="tbbar">
            <div class="tbbar__head"><h3>TB Screening <span style="color:var(--bad)">*</span></h3>
                <span>${code === 1 && (state.lab || []).some((r) => !r.lab_test) ? '<b style="color:var(--bad)">Sputum test is in your lab requests: press Send to Lab</b>' : code ? "Recorded" : "Required for every patient before this attendance can be closed"}</span></div>
            <div class="tbbar__opts">${TB_OPTIONS.map(([n, label]) => `<button class="tbopt ${code === n ? "on" : ""} ${n === 1 ? "alert" : ""}" data-tb="${n}" ${isLocked ? "disabled" : ""}>
                <span class="tbopt__n">${n}</span>${label}</button>`).join("")}</div></div>`;
    }

    function serviceForm(a) {
        const fields = SERVICE_FIELDS[a.service_type] || [];
        return `<div class="grid-2">${fields.map(([name, label, type, opt]) => {
            const value = a[name] ?? "";
            if (type === "select") return field(name, label, { type: "select", options: SEL(opt), value });
            if (type === "checkbox") return field(name, label, { type: "checkbox", value });
            if (type === "readonly") return field(name + "_ro", label, { value: value === "" ? "—" : value, attrs: "readonly", help: "Worked out automatically" }).replace(`data-f="${name}_ro"`, `id="ro-${name}"`);
            if (type === "textarea") return field(name, label, { type: "textarea", rows: 2, value });
            // Frappe stores unset numbers as 0; only show it where zero is a real answer
            const shown = type === "number" && value === 0 && !["gravida", "parity"].includes(name) ? "" : value;
            return field(name, label, { type, value: shown, attrs: opt || "" });
        }).join("")}</div>`;
    }

    function renderWorkspace(data) {
        ws = data;
        const a = ws.attendance, p = ws.patient, t = ws.triage, v = ws.visit, isLocked = a.status === "Completed";
        const isCwc = a.service_type === "CWC Attendance" && window.CWC;
        const isAnc = a.service_type === "ANC Attendance" && window.ANC;
        const isFp = a.service_type === "Family Planning" && window.FP;
        const isPnc = a.service_type === "Postnatal Attendance" && window.PNC;
        const isHtsForm = a.service_type === "HTS Attendance" && window.HTS;
        state = {
            lab: (a.lab_requests || []).map((r) => ({ ...r })),
            rx: (a.prescriptions || []).map((r) => ({ ...r })),
            proc: (a.procedures || []).map((r) => ({ procedure: r.procedure, qty: r.qty })),
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
            vitalTile("Temp", tl.temperature, "°C", tl.temperature >= 38 ? "bad" : ""),
            vitalTile("SpO₂", tl.spo2, "%", tl.spo2 < 95 ? "bad" : ""),
            vitalTile("Weight", tl.weight_kg, "kg", ""), vitalTile("Height", tl.height_cm, "cm", ""),
            vitalTile("BMI", tl.bmi, tl.bmi_category || "", tl.bmi >= 30 ? "warn" : ""),
        ].join("") : "";

        const followHtml = `<div class="subhead" style="${isHts ? "margin-top:0" : "display:none"}">Book the next appointment</div>
            ${field("follow_up_required", "Book a follow-up appointment", { type: "checkbox", value: a.follow_up_required })}
            <div id="fu-box" style="display:${a.follow_up_required ? "block" : "none"}">
                <div class="grid-2">${field("follow_up_date", "Date", { type: "date", value: a.follow_up_date, attrs: a.appointment ? "disabled" : "" })}
                ${field("follow_up_reason", "Reason", { value: a.follow_up_reason })}</div>
                ${a.appointment ? `<div class="printnote">Appointment ${esc(a.appointment)} has been booked.</div>` : ""}
            </div>`;
        root.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;gap:16px;flex-wrap:wrap">
                <div><div class="pagehead__eyebrow">${esc(CFG.title)} · ${esc(a.name)}</div><h1 class="pagehead__title" style="font-size:30px">${esc(p.full_name)}</h1></div>
                <div style="display:flex;gap:10px;align-items:center"><span class="tag tag--dest">${esc(a.service_type)}</span>${ws.bill ? `<span class="tag tag--dest" title="Charges so far for this visit">Bill so far: ${money(ws.bill.total)}</span>` : ""}${pill(v.status, "info")}<button class="btn" id="back">← Back to queue</button></div>
            </div>
            ${banner(p, { visit: v.name })}
            ${v.visit_source === "Referral In" ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">${referralLine(v)}${v.referral_letter ? ` · <a href="${esc(v.referral_letter)}" target="_blank" style="text-decoration:underline">referral letter</a>` : ""}</div>` : ""}
            ${isLocked ? '<div class="liveinfo ok">This attendance is completed and read-only.</div>' : ""}
            ${a.status === "Awaiting Lab" ? '<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Waiting for lab results. You can keep working on this attendance meanwhile.</div>' : ""}
            <div class="card" style="padding:20px 24px;${isHts ? "display:none" : ""}">
                <div class="card__head" style="margin-bottom:14px"><h3>Triage${t ? ` · ${timeOf(t.triage_datetime)}` : ""} ${t ? `<span class="tag tag--${esc(t.triage_priority)}">${esc(t.triage_priority)}</span>` : ""}</h3>
                    ${t && t.chief_complaint ? `<span class="meta">Complaint: ${esc(t.chief_complaint)}</span>` : ""}</div>
                ${t ? `<div class="vitals">${vitals}</div>${t.alerts ? `<div class="liveinfo" style="margin:12px 0 0">⚠ ${esc(t.alerts.replace(/\n/g, "; "))}</div>` : ""}` : empty("No triage recorded for this visit.")}
            </div>
            ${isHts ? "" : tbBar(a.tb_screening, isLocked)}
            <div class="ws">
                <div class="card" id="ws-form">
                    <div class="subtabs" id="subtabs">
                        <button class="subtab on" data-p="assess">${esc(a.service_type)}</button>
                        ${isCwc ? '<button class="subtab" data-p="imm">Immunizations</button>' : ""}
                        ${isHts ? "" : `<button class="subtab" data-p="invest">Investigations <span class="dotc" id="c-lab" style="display:none"></span></button>
                        <button class="subtab" data-p="rx">Prescription <span class="dotc" id="c-rx" style="display:none"></span></button>`}
                        <button class="subtab" data-p="ref">${isHts ? "Appointment &amp; Referral" : "Referral &amp; Follow-up"}</button>
                    </div>
                    <fieldset id="fs" style="border:0;padding:0;margin:0;min-width:0" ${isLocked ? "disabled" : ""}>
                    <div class="subpanel on" id="sp-assess">
                        ${isCwc ? '<div class="subhead" style="margin-top:0">1 · Child registration &amp; demographics</div><div id="cwc-head"></div><div id="cwc-form"></div>' : ""}
                        ${isPnc ? '<div class="subhead" style="margin-top:0">1 · Mother registration &amp; demographics</div><div id="pnc-head"></div><div id="pnc-form"></div>' : ""}
                        ${isFp ? '<div class="subhead" style="margin-top:0">1 · Client registration &amp; demographics</div><div id="fp-head"></div><div id="fp-form"></div>' : ""}
                        ${isAnc ? '<div class="subhead" style="margin-top:0">1 · Client registration &amp; demographics</div><div id="anc-head"></div><div id="anc-form"></div>' : ""}
                        ${isHtsForm ? '<div id="hts-form"></div>' : ""}
                        ${serviceForm(a)}
                        ${isHts ? "" : `<div class="subhead">Assessment &amp; plan</div>
                        ${field("assessment_notes", "Assessment / findings", { type: "textarea", rows: 4, value: a.assessment_notes })}
                        ${field("management_plan", "Management plan", { type: "textarea", rows: 4, value: a.management_plan })}
                        ${field("patient_advice", "Advice given", { type: "textarea", rows: 2, value: a.patient_advice })}`}
                    </div>
                    ${isCwc ? '<div class="subpanel" id="sp-imm"><div id="cwc-card-panel"></div></div>' : ""}
                    <div class="subpanel" id="sp-invest">
                        ${isLocked ? "" : `<div class="field"><input class="input" id="lab-add" placeholder="Search a test to request (e.g. haemoglobin, urinalysis, sputum)…"></div>`}
                        <div id="lab-rows"></div>
                        <div class="subhead">Lab results for this visit</div>
                        <div id="lab-results"></div>
                    </div>
                    <div class="subpanel" id="sp-rx">
                        <div id="rx-allergy"></div>
                        ${isLocked ? "" : `<div class="field"><input class="input" id="rx-add" placeholder="Search a medicine to prescribe…"></div>`}
                        <div id="rx-rows"></div>
                        <div id="proc-box"></div>
                    </div>
                    <div class="subpanel" id="sp-ref">
                        ${isHts ? followHtml : ""}
                        ${isHts ? '<div class="subhead">Referral</div>' : ""}
                        ${isAnc ? '<div class="printnote" style="margin-bottom:12px">Referrals out are recorded in section 7 of the ANC form.</div>' : `${field("refer_out", "Refer to another facility", { type: "checkbox", value: a.refer_out })}
                        <div id="ref-box" style="display:${a.refer_out ? "block" : "none"}">
                            <div class="grid-2">${field("referral_facility", "Facility", { value: a.referral_facility, placeholder: "Type to search or add" })}
                            ${field("referral_reason", "Reason for referral", { type: "textarea", rows: 2, value: a.referral_reason })}</div>
                        </div>`}
                        ${isHts ? "" : '<div class="subhead">Follow-up</div>'}
                        ${isHts ? "" : followHtml}
                    </div>
                    </fieldset>
                </div>
                <div class="ws__rail">
                    <div class="card"><div class="card__head" style="margin-bottom:12px"><h3>Clinic history</h3></div><div class="timeline" id="timeline"></div></div>
                </div>
            </div>
            <div class="actionbar"><div><button class="btn" id="save" ${isLocked ? "disabled" : ""}>Save draft</button> <span class="printnote" id="saved-note"></span></div>
                <div class="actionbar__right" id="actions"></div></div>`;
        bind(root, isLocked);
        if (isCwc) renderCwc(isLocked);
        if (isAnc) renderAnc(isLocked);
        if (isFp) renderFp(isLocked);
        if (isPnc) renderPnc(isLocked);
        if (isHtsForm) HTS.renderForm($("#hts-form"), ws.attendance, { locked: isLocked });
    }

    function cwcKind() {
        return ws.cwc && ws.cwc.registered ? (ws.attendance.cwc_visit_kind || "Revisit") : "New Visit";
    }
    function renderCwc(isLocked, keepForm) {
        const head = $("#cwc-head");
        if (!head) return;
        if (keepForm) Object.assign(ws.attendance, read($("#cwc-form")), CWC.multiValues($("#cwc-form")));
        const reload = (ctx) => { ws.cwc = ctx; dirty = true; renderCwc(isLocked, true); };
        CWC.renderHeader(head, ws.cwc, { attendance: ws.attendance.name, kind: cwcKind(), locked: isLocked, onChange: reload });
        CWC.renderForm($("#cwc-form"), ws.attendance, ws.cwc, { locked: isLocked });
        CWC.renderCard($("#cwc-card-panel"), ws.cwc, { attendance: ws.attendance.name, locked: isLocked, onChange: reload });
    }

    function renderPnc(isLocked, keepForm) {
        const head = $("#pnc-head");
        if (!head) return;
        if (keepForm) Object.assign(ws.attendance, read($("#pnc-form")), PNC.multiValues($("#pnc-form")));
        const reload = (ctx) => { ws.pnc = ctx; dirty = true; renderPnc(isLocked, true); };
        const visitNo = ws.pnc && ws.pnc.registered ? ws.pnc.history.length + 1 : 1;
        PNC.renderHeader(head, ws.pnc, { locked: isLocked, age: ws.patient.age, visitNo, onChange: reload });
        PNC.renderForm($("#pnc-form"), ws.attendance, ws.pnc, { locked: isLocked });
    }

    function renderFp(isLocked, keepForm) {
        const head = $("#fp-head");
        if (!head) return;
        if (keepForm) Object.assign(ws.attendance, read($("#fp-form")), FP.multiValues($("#fp-form")));
        const reload = (ctx) => { ws.fp = ctx; dirty = true; renderFp(isLocked, true); };
        FP.renderHeader(head, ws.fp, { locked: isLocked, age: ws.patient.age, sex: ws.patient.sex, onChange: reload });
        FP.renderForm($("#fp-form"), ws.attendance, ws.fp, { locked: isLocked });
    }

    function ancKind() {
        return ws.anc && ws.anc.registered && ws.anc.history.length ? "Revisit" : "New Client";
    }
    function renderAnc(isLocked, keepForm) {
        const head = $("#anc-head");
        if (!head) return;
        if (keepForm) Object.assign(ws.attendance, read($("#anc-form")), ANC.multiValues($("#anc-form")));
        const reload = (ctx) => { ws.anc = ctx; dirty = true; renderAnc(isLocked, true); };
        ANC.renderHeader(head, ws.anc, { kind: ancKind(), locked: isLocked, age: ws.patient.age, onChange: reload });
        const form = $("#anc-form");
        form.onReferral = (v) => { if (v === ANC.LAB) { const tab = $(".subtab[data-p=invest]"); if (tab) tab.click(); } refreshActions(); };
        ANC.renderForm(form, ws.attendance, ws.anc, { locked: isLocked });
    }

    function bind(root, isLocked) {
        $$("[data-tb]", root).forEach((b) => b.addEventListener("click", () => chooseTb(Number(b.dataset.tb))));
        $$(".subtab", root).forEach((b) => b.addEventListener("click", () => {
            $$(".subtab", root).forEach((x) => x.classList.toggle("on", x === b));
            $$(".subpanel", root).forEach((x) => x.classList.toggle("on", x.id === "sp-" + b.dataset.p));
        }));
        $("#back", root).addEventListener("click", () => {
            if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
            dirty = false; history.replaceState(null, "", location.pathname); showQueue();
        });
        $("#ws-form", root).addEventListener("input", () => (dirty = true));
        $("#ws-form", root).addEventListener("change", () => (dirty = true));
        const referOut = $("[data-f=refer_out]", root);
        if (referOut) referOut.addEventListener("change", (e) => ($("#ref-box", root).style.display = e.target.checked ? "block" : "none"));
        $("[data-f=follow_up_required]", root).addEventListener("change", (e) => ($("#fu-box", root).style.display = e.target.checked ? "block" : "none"));
        // live dates for ANC
        const lmp = $("[data-f=lmp]", root);
        if (lmp && $("#ro-edd")) lmp.addEventListener("change", () => {
            if (!lmp.value) return;
            const d = new Date(lmp.value); const edd = new Date(d.getTime() + 280 * 86400000);
            $("#ro-edd").value = edd.toISOString().slice(0, 10);
            $("#ro-gestation_weeks").value = Math.max(Math.floor((Date.now() - d.getTime()) / (7 * 86400000)), 0);
        });
        renderLab(); renderRx(); renderLabResults(); renderTimeline(ws.history); refreshActions();
        Desk.procedurePicker($("#proc-box", root), state.proc, { locked: isLocked, onChange: () => (dirty = true) });
        $("#save", root).addEventListener("click", () => save(true));
        if (!isLocked) {
            if (referOut) Desk.facilityField($("[data-f=referral_facility]", root));
            suggest($("#lab-add"), {
                fetch: (q) => M.test_types.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.category.toLowerCase().includes(q.toLowerCase())).slice(0, 12),
                render: (t) => ({ main: t.name, sub: `${t.category} · ${t.performed_where}` }),
                onPick: (t) => { addLab(t); $("#lab-add").value = ""; },
            });
            suggest($("#rx-add"), {
                fetch: (q) => call("consultation.search_drugs", { q }, { quiet: true }).catch(() => []),
                render: (i) => ({ main: i.item_name, sub: [i.strength, Number(i.price) ? `KSh ${i.price}${Number(i.course_qty) > 1 ? " per course of " + i.course_qty : ""}` : "no price set"].filter(Boolean).join(" · ") }),
                onPick: (i) => { addRx(i); $("#rx-add").value = ""; },
            });
        }
    }

    async function chooseTb(code) {
        const a = ws.attendance;
        if (Number(String(a.tb_screening || "0")[0]) === code) return;
        if (code === 1) {
            const ok = await new Promise((resolve) => modal({
                title: "Presumed TB",
                body: `<p style="margin:0;color:var(--ink-3)">This adds an <b>urgent sputum test</b> to the lab requests. Press <b>Send to Lab</b> to send it, together with any other tests.</p>`,
                foot: [{ label: "Cancel", onClick: (hh) => { resolve(false); hh.close(); } },
                       { label: "Presumed TB — add test request", cls: "btn--primary", onClick: (hh) => { resolve(true); hh.close(); } }],
                onClose: () => resolve(false),
            }));
            if (!ok) return;
        }
        await save(false);
        await api("set_tb_screening", { name: a.name, code });
        toast(code === 1 ? "Presumed TB recorded. Sputum test added to the lab requests: press Send to Lab." : "TB screening recorded");
        renderWorkspace(await api("workspace", { visit: ws.visit.name }));
        if (code === 1) { const tab = $(".subtab[data-p=invest]"); if (tab) tab.click(); }
    }

    // ---- lab requests
    function addLab(t) {
        if (state.lab.some((r) => r.test_type === t.name && !r.lab_test)) return toast(`${t.name} is already requested`, "warn");
        state.lab.push({ test_type: t.name, urgency: "Routine", clinical_notes: "" });
        dirty = true; renderLab(); refreshActions();
    }
    function renderLab() {
        const byName = Object.fromEntries(M.test_types.map((t) => [t.name, t]));
        const el = $("#lab-rows");
        el.innerHTML = state.lab.length ? state.lab.map((r, i) => {
            const sent = !!r.lab_test, t = byName[r.test_type] || {};
            const level = ["Positive", "Abnormal"].includes(r.result) ? "bad" : r.result ? "good" : "mute";
            return `<div class="linebox ${sent ? "locked" : ""}"><div class="linebox__row">
                <div><b style="color:var(--ink)">${esc(r.test_type)}</b> <span class="printnote">${esc(t.category || "")}${t.performed_where === "External" ? " · sent to external facility" : ""}</span></div>
                <div style="display:flex;gap:10px;align-items:center">
                    ${sent ? `${pill(r.lab_status || "Sent", r.lab_status === "Resulted" ? "good" : "info")} ${r.result ? pill(r.result, level) : ""}`
                        : `<select class="input" style="width:110px;padding:6px 10px" data-lab="${i}" data-k="urgency">${["Routine", "Urgent"].map((u) => `<option ${u === r.urgency ? "selected" : ""}>${u}</option>`).join("")}</select>
                           <button class="iconx" data-lab-del="${i}" title="Remove">×</button>`}
                </div></div>
                ${sent ? "" : `<input class="input" style="margin-top:10px" placeholder="Clinical notes for the lab (optional)" data-lab="${i}" data-k="clinical_notes" value="${esc(r.clinical_notes || "")}">`}</div>`;
        }).join("") : empty("No tests requested.");
        $$("[data-lab]", el).forEach((inp) => inp.addEventListener("input", () => (state.lab[inp.dataset.lab][inp.dataset.k] = inp.value)));
        $$("[data-lab-del]", el).forEach((b) => b.addEventListener("click", () => { state.lab.splice(Number(b.dataset.labDel), 1); dirty = true; renderLab(); refreshActions(); }));
        const n = state.lab.length, badge = $("#c-lab"); if (badge) { badge.style.display = n ? "" : "none"; badge.textContent = n; }
    }
    function renderLabResults() {
        const el = $("#lab-results");
        if (!ws.lab_tests.length) { el.innerHTML = '<div class="printnote">Nothing sent to the lab yet.</div>'; return; }
        el.innerHTML = ws.lab_tests.map((t) => `<div class="linebox"><div class="linebox__row"><b style="color:var(--ink)">${esc(t.test_type)}</b>
            <div>${pill(t.status, t.status === "Resulted" ? "good" : "info")} ${t.interpretation ? pill(t.interpretation, ["Positive", "Abnormal"].includes(t.interpretation) ? "bad" : "good") : ""}</div></div>
            ${t.results.some((r) => r.value) ? `<table class="rtable" style="margin-top:10px"><tr><th>Parameter</th><th>Result</th><th>Reference</th><th></th></tr>
                ${t.results.filter((r) => r.value).map((r) => `<tr><td>${esc(r.parameter)}</td><td><b>${esc(r.value)}</b> ${esc(r.unit || "")}</td><td class="printnote">${esc(r.reference || "")}</td><td class="flagcell ${esc(r.flag || "")}">${esc(r.flag || "")}</td></tr>`).join("")}</table>` : ""}
            ${t.result_comments ? `<div class="printnote" style="margin-top:8px">Lab comment: ${esc(t.result_comments)}</div>` : ""}
            ${t.external_report ? `<div style="margin-top:8px"><a href="${esc(t.external_report)}" target="_blank" class="btn btn--sm">Open external report</a></div>` : ""}</div>`).join("");
    }

    // ---- prescriptions
    function addRx(item) {
        const course = Number(item.course_qty) > 1 ? Number(item.course_qty) : "";
        state.rx.push({ drug: item.name, drug_name: item.item_name, dose: item.strength || "", route: "Oral", frequency: "", duration_days: "", quantity: course, instructions: "", _qtyTouched: !!course });
        dirty = true; renderRx(); refreshActions();
    }
    function autoQty(i) {
        const r = state.rx[i], per = FREQ[String(r.frequency || "").trim().toLowerCase()];
        if (per && Number(r.duration_days) > 0 && !r._qtyTouched) {
            r.quantity = per * Number(r.duration_days);
            const q = $(`[data-rx="${i}"][data-k="quantity"]`); if (q) q.value = r.quantity;
        }
    }
    function renderRx() {
        $("#rx-allergy").innerHTML = ws.patient.allergies ? `<div class="liveinfo" style="background:var(--bad-bg);color:var(--bad)">⚠ Allergies on record: ${esc(ws.patient.allergies)}</div>` : "";
        const el = $("#rx-rows"), routes = ["Oral", "IM", "IV", "Topical", "Rectal", "Inhalation", "Eye/Ear Drops", "Other"];
        el.innerHTML = state.rx.length ? state.rx.map((r, i) => `<div class="linebox">
            <div class="linebox__row" style="margin-bottom:10px"><b style="color:var(--ink)">${esc(r.drug_name || r.drug)}</b><button class="iconx" data-rx-del="${i}" title="Remove">×</button></div>
            <div class="grid-4">
                <div class="field"><label>Dose</label><input data-rx="${i}" data-k="dose" value="${esc(r.dose || "")}" placeholder="500 mg"></div>
                <div class="field"><label>Route</label><select data-rx="${i}" data-k="route">${routes.map((o) => `<option ${o === r.route ? "selected" : ""}>${o}</option>`).join("")}</select></div>
                <div class="field"><label>Frequency</label><input data-rx="${i}" data-k="frequency" value="${esc(r.frequency || "")}" placeholder="OD / BD"></div>
                <div class="field"><label>Days</label><input type="number" min="1" data-rx="${i}" data-k="duration_days" value="${esc(r.duration_days ?? "")}"></div></div>
            <div class="grid-4"><div class="field"><label>Quantity <span class="req">*</span></label><input type="number" min="0" step="any" data-rx="${i}" data-k="quantity" value="${esc(r.quantity ?? "")}"></div>
                <div class="field" style="grid-column:span 3"><label>Instructions</label><input data-rx="${i}" data-k="instructions" value="${esc(r.instructions || "")}"></div></div></div>`).join("")
            : empty("No medication prescribed.");
        $$("[data-rx]", el).forEach((inp) => inp.addEventListener("input", () => {
            const i = Number(inp.dataset.rx), k = inp.dataset.k; state.rx[i][k] = inp.value;
            if (k === "quantity") state.rx[i]._qtyTouched = true;
            if (k === "frequency" || k === "duration_days") autoQty(i);
        }));
        $$("[data-rx-del]", el).forEach((b) => b.addEventListener("click", () => { state.rx.splice(Number(b.dataset.rxDel), 1); dirty = true; renderRx(); refreshActions(); }));
        const n = state.rx.length, badge = $("#c-rx"); if (badge) { badge.style.display = n ? "" : "none"; badge.textContent = n; }
    }

    function renderTimeline(rows) {
        $("#timeline").innerHTML = rows.length ? rows.map((h) => `<div class="tl">
            <div class="tl__date">${esc(dateOf(h.attendance_date))} · ${esc(h.clinician_name || "")}</div>
            <div class="tl__dx">${esc(h.service_type)}</div>
            <div class="printnote">${esc([h.anc_visit_number && "ANC visit " + h.anc_visit_number, h.postnatal_visit_no && "PNC visit " + h.postnatal_visit_no, h.fp_method, h.growth_status, h.adherence && "Adherence: " + h.adherence, h.tb_screening].filter(Boolean).join(" · "))}</div>
            ${h.assessment_notes ? `<div class="tl__detail" style="display:block">${esc(h.assessment_notes)}</div>` : ""}</div>`).join("")
            : empty("First attendance at this clinic.");
    }

    // ---- actions
    function needTb() {
        if (isHts || ws.attendance.tb_screening) return false;   // the HIV testing clinic does no TB screening
        toast("Record the TB screening (1–4) first", "warn");
        const bar = $("#tbbar"); if (bar) bar.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
    }
    function refreshActions() {
        const box = $("#actions");
        if (locked()) { box.innerHTML = ""; return; }
        if (isHts) {
            box.innerHTML = `<button class="btn btn--primary" id="a-done">${ws.visit.consultation ? "Complete &amp; return to doctor ✓" : "Complete ✓"}</button>`;
            $("#a-done").addEventListener("click", () => act("complete", "Attendance completed"));
            return;
        }
        const unsent = state.lab.some((r) => !r.lab_test), hasRx = state.rx.length > 0;
        const highRisk = window.ANC && $("[data-f=anc_referral]")?.value === ANC.HIGH_RISK;   // she goes to the doctor, not home
        box.innerHTML = `
            ${unsent ? '<button class="btn btn--signal" id="a-lab">Send to Lab →</button>' : ""}
            <button class="btn ${highRisk && !unsent ? "btn--primary" : ""}" id="a-doc">Refer to Doctor</button>
            ${hasRx ? `<button class="btn ${unsent || highRisk ? "" : "btn--primary"}" id="a-rx">Send to Pharmacy →</button>`
                : `<button class="btn ${unsent || highRisk ? "" : "btn--primary"}" id="a-done">Complete ✓</button>`}`;
        const guard = () => { if (state.lab.some((r) => !r.lab_test)) { toast("Send the new lab requests first, or remove them.", "warn"); return true; } return needTb(); };
        $("#a-lab")?.addEventListener("click", () => act("send_to_lab", "Sent to the lab"));
        $("#a-doc")?.addEventListener("click", () => { if (!needTb()) act("refer_to_doctor", "Sent to the doctor's queue"); });
        $("#a-rx")?.addEventListener("click", () => { if (!guard()) act("send_to_pharmacy", "Sent to the pharmacy"); });
        $("#a-done")?.addEventListener("click", () => { if (!guard()) act("complete", "Attendance completed"); });
    }

    function collect() {
        const data = read($("#ws-form"));
        if ($("#cwc-form")) Object.assign(data, CWC.multiValues($("#cwc-form")));
        if ($("#anc-form")) Object.assign(data, ANC.multiValues($("#anc-form")));
        if ($("#fp-form")) Object.assign(data, FP.multiValues($("#fp-form")));
        if ($("#pnc-form")) Object.assign(data, PNC.multiValues($("#pnc-form")));
        if ($("#hts-form")) Object.assign(data, HTS.multiValues($("#hts-form")));
        data.lab_requests = state.lab.map(({ test_type, urgency, clinical_notes, lab_test }) => ({ test_type, urgency, clinical_notes, lab_test }));
        data.procedures = state.proc.map(({ procedure, qty }) => ({ procedure, qty }));
        data.prescriptions = state.rx.map(({ drug, dose, route, frequency, duration_days, quantity, instructions }) => ({ drug, dose, route, frequency, duration_days, quantity, instructions }));
        return data;
    }
    async function save(showToast) {
        await api("save", { name: ws.attendance.name, data: collect() });
        dirty = false;
        $("#saved-note").textContent = "Saved " + new Date().toTimeString().slice(0, 5);
        if (showToast) toast("Draft saved");
    }
    async function act(action, message) {
        const btns = $$(".actionbar button"); btns.forEach((b) => (b.disabled = true));
        try {
            await api("action", { name: ws.attendance.name, action, data: collect() });
            dirty = false; toast(message);
            history.replaceState(null, "", location.pathname); showQueue();
        } catch (e) {
            btns.forEach((b) => (b.disabled = false));
        }
    }

    // ============================================================ start
    const start = location.hash.replace("#/", "");
    if (start) { try { await openVisit(start); } catch (e) { showQueue(); } } else await loadAll();
    Desk.poll(() => { if ($("#view-ws").style.display === "none") loadAll(); });
})();
