/* Triage / front desk page */
(async function () {
    const { call, $, $$, esc, num, timeOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, banner, masters, COLORS } = Desk;

    await Desk.shell({
        page: "triage",
        eyebrow: "Mutara Clinic · Front Desk & Triage",
        title: "Triage",
        sub: "Register arrivals, take vitals and send patients through to the doctor",
        tools: `<button class="btn btn--primary" id="new-visit">＋ New patient / check-in</button>
                <button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => tab === "insights" && loadInsights());
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });
    $("#new-visit").addEventListener("click", startCheckIn);

    let data;
    const period = Desk.periodToggle($("#period"), () => loadInsights(), "day");

    // ------------------------------------------------------------ queue
    async function loadAll() {
        data = await call("triage.dashboard");
        renderKpis(data.kpis);
        renderWaiting(data.waiting);
        renderRecent(data.recent);
        renderJourney(data.arrived);
        if ($("#tab-insights").classList.contains("on")) loadInsights();
    }

    function renderKpis(k) {
        kpis($("#kpis"), [
            { label: "Waiting for Triage", value: k.waiting, cls: k.waiting ? "warn" : "", unit: k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "No one waiting" },
            { label: "Sent Onward Today", value: k.triaged_today, cls: "good", unit: `Avg wait to triage ${Desk.duration(k.avg_wait)}` },
            { label: "Visits Today", value: k.visits_today, unit: `${Desk.split(k.employees_today)}` },
            { label: "Urgent / Emergency", value: k.urgent_today, cls: k.urgent_today ? "bad" : "", unit: "Triaged today" },
            { label: "Vital Sign Alerts", value: k.with_alerts, cls: k.with_alerts ? "warn" : "", unit: "Patients with abnormal vitals today" },
            { label: "Referred In Today", value: k.referrals_in_today, cls: "info", unit: "From other facilities" },
        ]);
    }

    function renderWaiting(rows) {
        $("#waiting-meta").textContent = rows.length ? `${rows.length} in queue` : "";
        $("#waiting").innerHTML = rows.length ? rows.map((r, i) => `
            <div class="qcard"><div class="qcard__stripe"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                    ${r.visit_purpose && r.visit_purpose !== "Consultation" ? pill(r.visit_purpose, "info") : ""}
                    ${r.visit_source !== "Walk-in" ? pill(r.visit_source, "info") : ""}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}${r.department ? " · " + esc(r.department) : ""} · arrived ${timeOf(r.visit_date)}</div>
                ${r.reception_notes ? `<div class="qcard__note">${esc(r.reception_notes)}</div>` : ""}</div>
                <div class="qcard__side">${wait(r.wait_minutes, 15, 30)}
                    <button class="btn btn--primary btn--sm" data-triage="${esc(r.visit)}">Take vitals</button>
                    <button class="btn btn--link btn--sm" data-cancel="${esc(r.visit)}" title="Cancel visit">✕</button></div></div>`).join("")
            : empty("No one is waiting for triage.");
        $$("[data-triage]").forEach((b) => b.addEventListener("click", () => openTriage(b.dataset.triage)));
        $$("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
            if (!confirm("Cancel this visit?")) return;
            await call("common.cancel_visit", { visit: b.dataset.cancel });
            toast("Visit cancelled");
            loadAll();
        }));
    }

    function renderRecent(rows) {
        $("#recent-meta").textContent = rows.length ? `${rows.length} today` : "";
        $("#recent").innerHTML = rows.length ? rows.map((r) => `
            <div class="qcard"><div class="qcard__stripe ${esc(r.triage_priority)}"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                    <span class="tag tag--${esc(r.triage_priority)}">${esc(r.triage_priority)}</span></div>
                <div class="qcard__meta">${esc(r.visit)} · ${timeOf(r.triage_datetime)} · ${esc(r.chief_complaint || "")}</div>
                ${r.alerts ? `<div class="qcard__note alert">⚠ ${esc(r.alerts.replace(/\n/g, "; "))}</div>` : ""}</div>
                <div class="qcard__side"><span class="tag tag--dest">→ Doctor</span>${pill(r.status, r.status === "Waiting Consultation" ? "warn" : "mute")}
                    ${r.status === "Waiting Consultation" ? `<button class="btn btn--sm" data-triage="${esc(r.visit)}">Edit vitals</button>` : ""}</div></div>`).join("")
            : empty("No patients sent through yet today.");
        $$("#recent [data-triage]").forEach((b) => b.addEventListener("click", () => openTriage(b.dataset.triage)));
    }

    // Where each person who checked in at the door is on their way through the clinic
    const STAGE = { "Awaiting triage": "warn", "In consultation": "info", "In pharmacy": "info", Completed: "good" };
    function renderJourney(rows) {
        $("#journey-meta").textContent = rows.length ? `${rows.length} checked in today` : "Checked in on the clinic biometric today";
        $("#journey").innerHTML = rows.length ? rows.map((r) => `
            <div class="qcard${r.visit && r.stage === "Awaiting triage" ? " qcard--link" : ""}" ${r.visit && r.stage === "Awaiting triage" ? `data-triage="${esc(r.visit)}"` : ""}><div class="qcard__stripe"></div>
                <div><div class="qcard__name">${esc(r.patient_name)}</div>
                <div class="qcard__meta">${r.employee ? esc(r.employee) + " · " : ""}${r.department ? esc(r.department) + " · " : ""}in ${timeOf(r.time_in)}${r.time_out ? ` · out ${timeOf(r.time_out)}` : ""}</div></div>
                <div class="qcard__side">${r.wait_minutes != null ? wait(r.wait_minutes, 15, 30) : ""}${pill(r.stage, STAGE[r.stage] || "mute")}</div></div>`).join("")
            : empty("No one has checked in at the clinic yet today.");
        $$("#journey [data-triage]").forEach((c) => c.addEventListener("click", () => openTriage(c.dataset.triage)));
    }

    // ------------------------------------------------------------ insights
    async function loadInsights() {
        const d = await call("triage.insights", { period: period.value });
        const WORD = { day: "today", week: "this week", month: "this month" }[period.value];
        $("#range-meta").textContent = d.range.from === d.range.to ? Desk.dateOf(d.range.from) : `${d.range.from} → ${d.range.to}`;

        // Door to triage: green within the target, orange up to double it, red beyond
        const w = d.door_to_triage, LV = Desk.LEVEL;
        $("#door-meta").textContent = w.measured ? `${w.measured} patient${w.measured === 1 ? "" : "s"} ${WORD}` : "";
        kpis($("#door-kpis"), [
            { label: "Average", value: Desk.duration(w.average), cls: !w.measured ? "" : w.average <= w.target ? "good" : w.average <= w.target * 2 ? "warn" : "bad", unit: `Target ${w.target} min` },
            { label: "Longest", value: Desk.duration(w.longest), cls: w.longest > w.target * 2 ? "bad" : "" },
            { label: "Within target", value: `${w.within_target}%`, cls: !w.measured ? "" : w.within_target >= 80 ? "good" : w.within_target >= 50 ? "warn" : "bad", unit: w.measured ? `${w.from_door} timed from the door` : "" },
        ]);
        const bmax = Math.max(...w.buckets.map((b) => b.value), 1);
        $("#door-bars").innerHTML = w.measured ? w.buckets.map((b) => `<div class="hb"><div class="hb__name">${esc(b.label)}</div>
            <div class="hb__lane"><div class="hb__est"></div><div class="hb__act ${b.level}" style="width:${b.value / bmax * 100}%"></div></div>
            <div class="hb__pct">${b.value}</div></div>`).join("") + `<div class="lvl-legend"><span><i style="background:${LV.good}"></i>On target</span><span><i style="background:${LV.warn}"></i>Slow</span><span><i style="background:${LV.bad}"></i>Too long</span></div>`
            : empty("No patients had vitals taken in this period.");

        // Triage priority ring
        const pc = { Routine: LV.good, Urgent: LV.warn, Emergency: LV.bad };
        const ptotal = d.priority.reduce((a, r) => a + r.value, 0);
        $("#priority-meta").textContent = ptotal ? `${ptotal} triaged` : "";
        $("#priority-mid").innerHTML = `<b>${ptotal}</b><span>Triaged</span>`;
        $("#priority-chips").innerHTML = ["Routine", "Urgent", "Emergency"].map((k) => {
            const n = (d.priority.find((r) => r.label === k) || {}).value || 0;
            return `<span class="chip" style="--c:${pc[k]}"><i></i>${k} <b>${n}</b></span>`;
        }).join("");
        chart("priority-chart", { type: "doughnut", data: { labels: d.priority.map((r) => r.label), datasets: [{ data: ptotal ? d.priority.map((r) => r.value) : [1], backgroundColor: ptotal ? d.priority.map((r) => pc[r.label]) : ["rgba(10,10,10,0.06)"], borderWidth: 4, borderColor: "#fff", hoverOffset: 8, borderRadius: 8 }] }, options: { cutout: "70%", plugins: { legend: { display: false }, tooltip: { enabled: !!ptotal } } } });

        // Screening flags: green under 10% of patients, orange to 25%, red beyond
        const f = d.flags, total = f.total || 0;
        $("#flag-meta").textContent = `${total} patient${total === 1 ? "" : "s"} triaged ${WORD}`;
        const share = (v) => (total ? v * 100 / total : 0);
        hbars($("#flags"), [
            { label: "Fever", value: f.fever }, { label: "High BP", value: f.high_bp },
            { label: "Low oxygen", value: f.low_spo2 }, { label: "Fast pulse", value: f.tachycardia },
            { label: "Abnormal glucose", value: f.glucose }, { label: "Obese (BMI ≥ 30)", value: f.obese },
        ], { format: (v) => `${v} <span style="color:var(--ink-mute)">(${Math.round(share(v))}%)</span>`, cls: (r) => (share(r.value) > 25 ? "bad" : share(r.value) >= 10 ? "warn" : "good") });

        // Arrivals by hour: smooth, colourful curves
        const h = d.by_hour, hours = Array.from({ length: 17 }, (_, i) => i + 5), at = (a) => hours.map((x) => a[x] || 0);
        const series = [];
        if (h.checked_in) series.push({ label: "Checked in at the door", values: at(h.checked_in), colors: ["#2c6bb3", "#228883"] });
        series.push({ label: "Registered", values: at(h.registered), colors: ["#e07a3a", "#d6558b"] });
        series.push({ label: "Vitals taken", values: at(h.triaged), colors: ["#8a4fd0", "#2f9e5b"] });
        Desk.smoothLine("hour-chart", hours.map((x) => `${String(x).padStart(2, "0")}:00`), series);
    }

    // ------------------------------------------------------------ check-in
    function startCheckIn() {
        Desk.pickPatient({
            onPick: async (p) => {
                if (p.open_visit) {
                    toast(`${p.full_name} already has an open visit (${p.open_visit.status}).`, "warn");
                    if (p.open_visit.status === "Waiting Triage") openTriage(p.open_visit.name);
                    return;
                }
                openCheckIn(p);
            },
        });
    }

    async function openCheckIn(p) {
        const m = await masters();
        const h = modal({
            title: "Check in",
            sub: "Record how the patient arrived",
            body: `${banner(p)}
                <div class="grid-2">
                    ${field("visit_purpose", "Reason for visit", { type: "select", options: ["Consultation", "Pre-Employment Medical", "Post-Employment Medical"] })}
                    ${field("visit_source", "Arrived as", { type: "select", options: ["Walk-in", "Appointment", "Follow-up", "Referral In"] })}
                </div>
                <div id="ref-box" style="display:none">
                    <div class="subhead">Referred from another facility</div>
                    <div class="grid-2">
                        ${field("referring_facility", "Referring facility", { placeholder: "Type to search or add" })}
                        ${field("referring_clinician", "Referring clinician")}
                    </div>
                    ${field("referral_reason", "Reason for referral", { type: "textarea", rows: 2 })}
                </div>
                ${field("reception_notes", "Notes", { type: "textarea", rows: 2, placeholder: "Anything the nurse should know" })}`,
            foot: [
                { label: "Cancel" },
                { label: "Check in only", onClick: (hh) => submit(hh, false) },
                { label: "Check in & take vitals", cls: "btn--primary", onClick: (hh) => submit(hh, true) },
            ],
        });
        Desk.facilityField($("[data-f=referring_facility]", h.body));
        const src = $("[data-f=visit_source]", h.body);
        src.addEventListener("change", () => { $("#ref-box", h.body).style.display = src.value === "Referral In" ? "block" : "none"; });

        async function submit(hh, thenTriage) {
            const v = read(hh.body);
            if (v.visit_source === "Referral In" && !v.referring_facility) return toast("Select the referring facility", "warn");
            const r = await call("common.check_in", { patient: p.name, ...v });
            toast(`${p.full_name} checked in (${r.visit})`);
            hh.close();
            await loadAll();
            if (thenTriage) openTriage(r.visit);
        }
    }

    // ------------------------------------------------------------ triage form
    const VITAL_RULES = (v) => {
        const a = [];
        let severe = false;
        const n = (x) => (x === "" || x == null ? null : Number(x));
        const t = n(v.temperature), s = n(v.spo2), sys = n(v.bp_systolic), dia = n(v.bp_diastolic), pr = n(v.pulse_rate), rr = n(v.respiratory_rate), g = n(v.blood_glucose);
        if (t != null && t >= 38) a.push(`Fever (${t} °C)`); else if (t != null && t < 35.5) a.push(`Low temperature (${t} °C)`);
        if (t != null && t >= 40) severe = true;
        if (s != null && s < 95) a.push(`Low oxygen saturation (${s}%)`);
        if (s != null && s < 90) severe = true;
        if (sys != null && dia != null && (sys >= 140 || dia >= 90)) a.push(`High BP (${sys}/${dia})`);
        else if (sys != null && sys < 90) a.push(`Low BP (${sys}/${dia})`);
        if (sys != null && (sys < 80 || sys >= 180)) severe = true;
        if (pr != null && pr > 100) a.push(`Tachycardia (${pr} bpm)`); else if (pr != null && pr < 60) a.push(`Bradycardia (${pr} bpm)`);
        if (pr != null && (pr > 140 || pr < 40)) severe = true;
        if (rr != null && (rr > 24 || rr < 12)) a.push(`Abnormal respiratory rate (${rr}/min)`);
        if (g != null && (g > 11.1 || g < 3.9)) a.push(`Abnormal glucose (${g} mmol/L)`);
        return { alerts: a, severe };
    };

    async function openTriage(visit) {
        const ctx = await call("triage.get_triage_context", { visit });
        const ex = ctx.existing || {};
        const prev = ctx.previous[0];
        const val = (k, fallback = "") => (ex[k] != null ? ex[k] : fallback);
        const canRoute = ["Waiting Triage", "Waiting Consultation"].includes(ctx.visit.status);
        const h = modal({
            title: ex.name ? "Update vitals" : "Take vitals",
            sub: `${esc(ctx.visit.name)} · arrived ${timeOf(ctx.visit.visit_date)}${ctx.visit.visit_purpose !== "Consultation" ? " · " + esc(ctx.visit.visit_purpose) : ""}${ctx.visit.visit_source !== "Walk-in" ? " · " + esc(ctx.visit.visit_source) : ""}`,
            size: "wide",
            body: `${banner(ctx.patient)}
                ${ctx.visit.reception_notes ? `<div class="liveinfo ok" style="background:var(--info-bg);color:var(--info)">Reception: ${esc(ctx.visit.reception_notes)}</div>` : ""}
                ${prev ? `<div class="printnote" style="margin-bottom:14px">Last recorded ${esc(Desk.dateOf(prev.triage_datetime))}: ${[prev.weight_kg && prev.weight_kg + " kg", prev.height_cm && prev.height_cm + " cm", prev.bp_systolic && `BP ${prev.bp_systolic}/${prev.bp_diastolic}`, prev.pulse_rate && prev.pulse_rate + " bpm"].filter(Boolean).join(" · ")}</div>` : ""}
                <div class="subhead">Vital signs</div>
                <div class="grid-4">
                    ${field("bp_systolic", "BP systolic (mmHg)", { type: "number", value: val("bp_systolic"), attrs: 'min="40" max="300"' })}
                    ${field("bp_diastolic", "BP diastolic (mmHg)", { type: "number", value: val("bp_diastolic"), attrs: 'min="20" max="200"' })}
                    ${field("pulse_rate", "Pulse (bpm)", { type: "number", value: val("pulse_rate"), attrs: 'min="20" max="250"' })}
                    ${field("temperature", "Temperature (°C)", { type: "number", value: val("temperature"), attrs: 'step="0.1" min="25" max="45"' })}
                    ${field("spo2", "Blood oxygen SpO₂ (%)", { type: "number", value: val("spo2"), attrs: 'min="30" max="100"' })}
                    ${field("respiratory_rate", "Respiratory rate (/min)", { type: "number", value: val("respiratory_rate") })}
                    ${field("weight_kg", "Weight (kg)", { type: "number", value: val("weight_kg"), attrs: 'step="0.1"' })}
                    ${field("height_cm", "Height (cm)", { type: "number", value: val("height_cm", prev?.height_cm || ""), attrs: 'step="0.1"' })}
                </div>
                <div class="grid-4">
                    <div class="field"><label>BMI</label><div class="input" id="bmi" style="background:transparent">—</div></div>
                    ${field("blood_glucose", "Random glucose (mmol/L)", { type: "number", value: val("blood_glucose"), attrs: 'step="0.1"' })}
                </div>
                <div id="live"></div>
                <div class="subhead">Assessment</div>
                ${field("chief_complaint", "Chief complaint", { type: "textarea", rows: 2, value: val("chief_complaint"), required: true, placeholder: "Why has the patient come today?" })}
                <div class="grid-2">
                    ${field("triage_priority", "Priority", { type: "select", options: ["Routine", "Urgent", "Emergency"], value: val("triage_priority", "Routine") })}
                    ${field("triage_notes", "Nurse notes", { type: "textarea", rows: 2, value: val("triage_notes") })}
                </div>`,
            foot: [
                { label: "Cancel" },
                { label: canRoute && !ex.name ? "Send to Doctor" : "Update vitals", cls: "btn--primary", onClick: (hh) => send(hh) },
            ],
        });

        async function send(hh) {
            const v = read(hh.body);
            if (!v.chief_complaint.trim()) { toast("Enter the chief complaint", "warn"); return; }
            await call("triage.save_triage", { visit, data: v });
            toast(canRoute && !ex.name ? "Sent to the doctor" : "Vitals updated");
            hh.close();
            loadAll();
        }

        let manualPriority = !!ex.name;
        const prio = $("[data-f=triage_priority]", h.body);
        prio.addEventListener("change", () => (manualPriority = true));
        const update = () => {
            const v = read(h.body);
            const w = Number(v.weight_kg), ht = Number(v.height_cm);
            $("#bmi", h.body).textContent = w && ht ? (w / Math.pow(ht / 100, 2)).toFixed(1) : "—";
            const { alerts, severe } = VITAL_RULES(v);
            $("#live", h.body).innerHTML = alerts.length
                ? `<div class="liveinfo">⚠ ${alerts.map(esc).join(" · ")}</div>`
                : (v.bp_systolic || v.temperature || v.spo2 || v.pulse_rate) ? '<div class="liveinfo ok">Vitals within normal limits</div>' : "";
            if (!manualPriority) prio.value = severe ? "Emergency" : alerts.length ? "Urgent" : "Routine";
        };
        $$("input", h.body).forEach((i) => i.addEventListener("input", update));
        update();
        $("[data-f=bp_systolic]", h.body).focus();
    }

    await loadAll();
    Desk.poll(loadAll);
})();
