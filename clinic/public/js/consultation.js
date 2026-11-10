/* Doctor / consultation page: queue and the single-screen patient workspace */
(async function () {
    const { call, $, $$, esc, money, num, timeOf, dateOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, suggest, banner, masters, COLORS } = Desk;

    await Desk.shell({
        page: "consultation",
        eyebrow: "Northlake Medical Centre · Doctor",
        title: "Consultation",
        sub: "Patients sent from triage, results back from the lab, and everything you need to treat them",
        tools: `<button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => { if (tab === "insights") loadInsights(); else if (tab === "seen") loadSeen(); else if (tab === "inc") loadIncReport(); });
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
        if ($("#tab-insights").classList.contains("on")) loadInsights();
        if ($("#tab-seen").classList.contains("on")) loadSeen();
    }

    // Top tiles: lively, and each one takes you to what it counts
    const ICON = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const GO = (id) => () => {
        const tab = $('.tab[data-tab="queue"]'); if (tab && !tab.classList.contains("on")) tab.click();
        const t = $(id); if (!t) return;
        t.scrollIntoView({ behavior: "smooth", block: "center" });
        t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
    };
    function renderKpis(k) {
        const P = Desk.PALETTE;
        Desk.livelyTiles($("#kpis"), [
            { label: "Awaiting Consultation", value: k.waiting, color: P[1], hint: "See the queue", onClick: GO("#tile-waiting"),
              icon: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), unit: k.emergency ? `${k.emergency} urgent / emergency` : k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "Queue is clear" },
            { label: "Lab Results Ready", value: k.results_ready, color: P[4], hint: "See the list", onClick: GO("#tile-results"),
              icon: ICON('<path d="M9 3h6v4l4 11a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-11z"/>'), unit: k.results_ready ? "Awaiting your review" : "No results waiting" },
            { label: "Open Consultations", value: k.in_progress, color: P[0], hint: "See the list", onClick: GO("#tile-open"),
              icon: ICON('<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>'), unit: "In progress now" },
            { label: "Seen Today", value: k.seen_today, color: P[6], hint: "Patients seen", onClick: () => $('.tab[data-tab="seen"]').click(),
              icon: ICON('<path d="M20 6 9 17l-5-5"/>'), unit: Desk.split(k.employees_today, k.community_today) },
            { label: "Avg Wait for Doctor", value: `${k.avg_wait}<span style="font-size:15px;font-weight:600"> min</span>`, color: P[3],
              icon: ICON('<path d="M5 3h14M5 21h14M7 3v4a5 5 0 0 0 10 0V3M7 21v-4a5 5 0 0 1 10 0v4"/>'), unit: "Triage → consultation, today" },
            { label: "Referred Out / Sick-off", value: `${k.referrals_out} <span style="font-size:15px;font-weight:600;color:var(--ink-mute)">/ ${k.sick_days}d</span>`, color: P[5],
              icon: ICON('<path d="M5 12h14M13 6l6 6-6 6"/>'), unit: `${k.work_related} work-related · ${k.follow_ups_week} follow-ups this week` },
        ]);
    }

    function queueCard(r, button, extra = "") {
        return `<div class="qcard"><div class="qcard__stripe ${esc(r.priority || "")}"></div>
            <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}
                ${r.priority ? `<span class="tag tag--${esc(r.priority)}">${esc(r.priority)}</span>` : ""}</div>
            <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}${r.department ? " · " + esc(r.department) : ""}</div>
            ${r.chief_complaint ? `<div class="qcard__note">${esc(r.chief_complaint)}</div>` : ""}
            ${r.alerts ? `<div class="qcard__note alert">⚠ ${esc(r.alerts.replace(/\n/g, "; "))}</div>` : ""}${extra}</div>
            <div class="qcard__side">${r.wait_minutes != null ? wait(r.wait_minutes, 20, 45) : ""}${button}</div></div>`;
    }

    const emptyTile = (path, text) => `<div class="empty"><span class="empty__ico">${ICON(path)}</span>${esc(text)}</div>`;
    function setCount(id, n) {
        const el = $(id);
        if (el.textContent !== String(n)) { el.textContent = n; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    }

    function renderQueues(d) {
        setCount("#waiting-meta", d.waiting.length);
        $("#waiting").innerHTML = d.waiting.length
            ? d.waiting.map((r) => queueCard(r, `<button class="btn btn--primary btn--sm" data-open="${esc(r.visit)}">Start consultation</button>`)).join("")
            : emptyTile('<path d="M20 6 9 17l-5-5"/>', "No patients waiting. You're all caught up.");

        setCount("#results-meta", d.results_ready.length);
        $("#ready").innerHTML = d.results_ready.length
            ? d.results_ready.map((r) => queueCard(r, `<button class="btn btn--signal btn--sm" data-open="${esc(r.visit)}">Review results</button>`,
                `<div class="qcard__note">${r.tests.map((t) => `${esc(t.test_type)}: <b style="color:${t.interpretation === "Positive" || t.interpretation === "Abnormal" ? "var(--bad)" : "var(--good)"}">${esc(t.interpretation || t.status)}</b>`).join(" · ")}</div>`)).join("")
            : emptyTile('<path d="M9 3h6v4l4 11a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-11z"/>', "No lab results waiting.");

        setCount("#open-meta", d.in_progress.length);
        $("#progress").innerHTML = d.in_progress.length
            ? d.in_progress.map((r) => queueCard(r, `<button class="btn btn--sm" data-open="${esc(r.visit)}">Continue</button>`)).join("")
            : emptyTile('<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>', "No consultations open right now.");

        setCount("#flight-meta", d.in_flight.length);
        $("#flight").innerHTML = d.in_flight.length
            ? d.in_flight.map((r) => `<div class="qcard"><div class="qcard__stripe"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))}</div></div>
                <div class="qcard__side">${pill(r.status, r.status === "Waiting Lab" ? "info" : "warn")}
                <button class="btn btn--link btn--sm" data-open="${esc(r.visit)}">Open</button></div></div>`).join("")
            : emptyTile('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/>', "No one at the lab or pharmacy.");

        $$("[data-open]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openVisit(b.dataset.open); }));
        // the whole waiting / open card opens the consultation, not only its button
        $$("#waiting .qcard, #progress .qcard, #ready .qcard").forEach((c) => {
            const btn = $("[data-open]", c);
            if (!btn) return;
            c.classList.add("qcard--link");
            c.addEventListener("click", () => openVisit(btn.dataset.open));
        });
    }

    const outcome = (r) => (r.refer_out ? pill("Referred out", "warn") : pill("Treated", "good"));

    // "Download file": the doctor chooses between this encounter and the patient's entire file
    const fileCell = (r) => `<td class="num"><button class="btn btn--sm" data-file="${esc(r.consultation)}" data-patient="${esc(r.patient_name)}" data-when="${esc(dateOf(r.consultation_date))}">Download file</button></td>`;
    function bindFiles(root) {
        $$("[data-file]", root).forEach((b) => b.addEventListener("click", () => chooseFile(b.dataset.file, b.dataset.patient, b.dataset.when)));
    }
    function chooseFile(consultation, patient, when) {
        const open = (scope) => window.open(`/clinic/patientfile?consultation=${encodeURIComponent(consultation)}&scope=${scope}`, "_blank");
        const choice = (scope, title, note) => `<button type="button" class="btn" data-scope="${scope}" style="display:block;width:100%;text-align:left;white-space:normal;line-height:1.45;padding:16px 18px;margin-bottom:12px;border-radius:16px"><b style="font-size:15px;color:var(--ink)">${title}</b><br><span class="printnote" style="font-weight:400">${note}</span></button>`;
        const m = modal({
            title: "Download file", sub: esc(patient),
            body: `${choice("encounter", "Latest encounter", `Only the encounter of ${esc(when)}: vitals, history, examination, diagnosis, results and treatment.`)}
                ${choice("full", "Entire file", "Every completed visit on record for this patient, newest first, with a summary of the visits at the front.")}
                <div class="printnote">The file opens in a new tab. Choose <b>Save as PDF</b> to download it. Each download is logged on the consultation.</div>`,
            foot: [{ label: "Cancel" }],
        });
        $$("[data-scope]", m.body).forEach((b) => b.addEventListener("click", () => { open(b.dataset.scope); m.close(); }));
    }

    // ---- Patients seen: by date range, with quick Today / This week / This month
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const now = new Date();
    $("#s-from").value = $("#s-to").value = iso(now);
    const QUICK = {
        today: () => [now, now],
        week: () => { const s = new Date(now); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return [s, now]; },
        month: () => [new Date(now.getFullYear(), now.getMonth(), 1), now],
    };
    const markQuick = (k) => $$("[data-sq]").forEach((b) => b.classList.toggle("on", b.dataset.sq === k));
    $$("[data-sq]").forEach((b) => b.addEventListener("click", () => {
        const [a, z] = QUICK[b.dataset.sq](); $("#s-from").value = iso(a); $("#s-to").value = iso(z); markQuick(b.dataset.sq); loadSeen();
    }));
    ["#s-from", "#s-to"].forEach((id) => $(id).addEventListener("change", () => { markQuick(""); loadSeen(); }));
    let searchTimer;
    $("#s-q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadSeen, 300); });

    async function loadSeen() {
        const d = await call("consultation.seen", { from_date: $("#s-from").value, to_date: $("#s-to").value, q: $("#s-q").value });
        const s = d.summary, one = d.range.from === d.range.to, P = Desk.PALETTE;
        $("#seen-meta").textContent = one ? Desk.dateOf(d.range.from) : `${d.range.from} → ${d.range.to}`;
        Desk.livelyTiles($("#seen-kpis"), [
            { label: "Patients Seen", value: s.total, color: P[6], icon: ICON('<path d="M20 6 9 17l-5-5"/>'), unit: one ? "In this day" : "In this period" },
            { label: "Employees Treated", value: s.employees, color: P[0], icon: ICON('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'), unit: "Patients seen" },
            { label: "Referred Out", value: s.referred, color: P[1], icon: ICON('<path d="M5 12h14M13 6l6 6-6 6"/>'), unit: "To other facilities" },
            { label: "Sick-off Days", value: s.sick_days, color: P[5], icon: ICON('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'), unit: `${s.work_related} work-related cases` },
        ]);
        $("#seen-rows").innerHTML = d.rows.length ? `<table class="dtable"><tr><th>${one ? "Time" : "Date"}</th><th>Patient</th><th>Type</th><th>Diagnosis</th><th class="num">Sick-off</th><th>Outcome</th><th></th></tr>
            ${d.rows.map((r) => `<tr><td>${one ? timeOf(r.consultation_date) : `${esc(dateOf(r.consultation_date).slice(5))} ${timeOf(r.consultation_date)}`}</td><td><b style="color:var(--ink)">${esc(r.patient_name)}</b><br><span class="printnote">${esc(ageSex(r))}</span></td>
            <td>${typeTag(r.patient_type)}</td><td>${esc(r.diagnoses || "—")}</td><td class="num">${r.sick_leave_days || "—"}</td>
            <td>${outcome(r)}</td>${fileCell(r)}</tr>`).join("")}</table>` : empty("No patients seen in this period.");
        bindFiles($("#seen-rows"));
    }

    // ---- monthly accidents & incidents (register + report)
    const incMonth = $("#inc-month"); incMonth.value = new Date().toISOString().slice(0, 7);
    ["inc-month", "inc-ptype", "inc-type"].forEach((id) => $("#" + id).addEventListener("change", loadIncReport));
    const incQs = () => ({ month: incMonth.value, patient_type: $("#inc-ptype").value || undefined, report_type: $("#inc-type").value || undefined });
    $("#inc-print").addEventListener("click", () => { const q = incQs(); window.open("/clinic/incident_report?" + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))), "_blank"); });
    async function loadIncReport() {
        if (!incMonth.value) return;
        const d = await call("incident.monthly", incQs()), s = d.summary, pv = d.previous;
        const trend = (a, b) => (a === b ? "same as " + d.previous_period : (a > b ? "▲ " : "▼ ") + Math.abs(a - b) + " vs " + d.previous_period);
        $("#inc-meta").textContent = `${d.period} · ${s.total} record${s.total === 1 ? "" : "s"}`;
        kpis($("#inc-kpis"), [
            { label: "Accidents / Incidents", value: s.total, cls: s.total ? "warn" : "good", unit: trend(s.total, pv.total) },
            { label: "Accidents", value: s.accidents, unit: `${s.incidents} incidents · ${s.near_misses} near misses` },
            { label: "Serious", value: s.serious, cls: s.serious ? "bad" : "good", unit: s.fatal ? `${s.fatal} fatal` : "Severe or fatal" },
            { label: "Work-related", value: s.work_related, cls: s.work_related ? "bad" : "", unit: "Happened on duty" },
            { label: "Days Lost", value: s.lost_days, unit: `${s.referred} referred out` },
            { label: "Open / Statutory Pending", value: `${s.open} <span style="font-size:14px;color:var(--ink-mute)">/ ${s.statutory_pending}</span>`, cls: s.statutory_pending ? "warn" : "", unit: "Reports to close / file" },
        ]);
        const SEV = { Minor: "#1a8a3a", Moderate: "#e68a00", Severe: "#c4302b", Fatal: "#7a1410" };
        chart("inc-sev", { type: "doughnut", data: { labels: d.by_severity.map((r) => r.label), datasets: [{ data: d.by_severity.map((r) => r.count), backgroundColor: d.by_severity.map((r) => SEV[r.label] || "#888") }] }, options: { plugins: { legend: { position: "right" } }, scales: {} } });
        chart("inc-day", { type: "bar", data: { labels: d.by_day.map((r) => r.day.slice(8)), datasets: [{ label: "Events", data: d.by_day.map((r) => r.count), backgroundColor: "#c4302b", borderRadius: 4, maxBarThickness: 22 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } } });
        Desk.hbars($("#inc-cause"), d.by_cause.slice(0, 8).map((r) => ({ label: r.label, value: r.count })), { cls: () => "warn" });
        Desk.hbars($("#inc-dept"), d.by_department.slice(0, 8).map((r) => ({ label: r.label, value: r.count })));
        const sevPill = { Minor: "good", Moderate: "warn", Severe: "bad", Fatal: "bad" };
        $("#inc-table").innerHTML = d.rows.length ? `<table class="dtable"><tr><th>Date</th><th>Patient</th><th>Type</th><th>Severity</th><th>Cause / injury</th><th>Outcome</th><th class="num">Days lost</th><th>Status</th></tr>
            ${d.rows.map((r) => `<tr><td>${esc(dateOf(r.incident_date).slice(5))}${r.incident_time ? " " + esc(String(r.incident_time).slice(0, 5)) : ""}</td>
            <td><b style="color:var(--ink)">${esc(r.patient_name)}</b><br><span class="printnote">${esc(r.department || r.employer || r.patient_type || "")}${r.work_related ? " · work-related" : ""}</span></td>
            <td>${esc(r.report_type)}</td><td>${pill(r.severity, sevPill[r.severity] || "info")}</td>
            <td>${esc([r.cause, r.injury_type, r.body_part].filter(Boolean).join(" · ") || "—")}</td><td>${esc(r.outcome || "—")}</td>
            <td class="num">${r.lost_days || "—"}</td><td>${pill(r.status, r.status === "Closed" ? "good" : "warn")}${r.doshmis_status === "Pending" ? " " + pill("DOSHS pending", "bad") : ""}</td></tr>`).join("")}</table>` : empty("No accidents or incidents recorded in " + d.period + ".");
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
            { label: "Investigations", value: w.lab_requests, unit: "requested", color: P[4], icon: ico('<path d="M9 3h6v4l4 11a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-11z"/>') },
            { label: "Drugs prescribed", value: w.prescriptions, unit: "medicine lines", color: P[2], icon: ico('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M10 8l4 8" />') },
            { label: "Referred out", value: w.referrals, unit: "to other facilities", color: P[1], icon: ico('<path d="M5 12h14M13 6l6 6-6 6"/>') },
            { label: "Work-related", value: w.work_related, unit: `cases · ${w.incidents} accident/incident${w.incidents === 1 ? "" : "s"}`, color: P[5], icon: ico('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>') },
            { label: "Follow-ups", value: w.follow_ups, unit: "booked", color: P[6], icon: ico('<path d="M20 6 9 17l-5-5"/>') },
        ]);

        $("#series-title").textContent = period.value === "day" ? "Consultations by Hour" : "Consultations by Day";
        chart("day-chart", { type: "bar", data: { labels: d.series.labels, datasets: [{ label: "Consultations", data: d.series.values, backgroundColor: d.series.values.map((_, i) => P[i % P.length]), borderRadius: 8, maxBarThickness: 30 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }

    // ============================================================ routing
    async function openVisit(visit) {
        let data = await call("consultation.workspace", { visit });
        if (!data.consultation) {
            await call("consultation.start", { visit });
            data = await call("consultation.workspace", { visit });
        }
        renderWorkspace(data);
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

    function vitalTile(label, value, unit, level) {
        return !value ? "" : `<div class="vital ${level || ""}"><small>${label}</small><b>${esc(value)}</b><em>${unit}</em></div>`;
    }

    function renderWorkspace(data) {
        ws = data;
        const c = ws.consultation, p = ws.patient, t = ws.triage, v = ws.visit;
        const isEmp = p.patient_type === "Employee";
        const locked = c.status === "Completed";
        state = {
            lab: (c.lab_requests || []).map((r) => ({ ...r })),
            dx: (c.diagnoses || []).map((r) => ({ ...r })),
            rx: (c.prescriptions || []).map((r) => ({ ...r })),
            proc: (c.procedures || []).map((r) => ({ procedure: r.procedure, qty: r.qty })),
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

        root.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;gap:16px;flex-wrap:wrap">
                <div><div class="pagehead__eyebrow">Consultation · ${esc(c.name)}</div>
                <h1 class="pagehead__title" style="font-size:30px">${esc(p.full_name)}</h1></div>
                <div style="display:flex;gap:10px;align-items:center">${ws.bill ? `<span class="tag tag--dest" title="Charges so far for this visit">Bill so far: ${money(ws.bill.total)}</span>` : ""}${pill(v.status, "info")}
                    <button class="btn" id="back">← Back to queue</button></div>
            </div>
            ${banner(p, { visit: v.name })}
            ${v.visit_source === "Referral In" ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Referred in from <b>${esc(v.referring_facility || "another facility")}</b>${v.referring_clinician ? " by " + esc(v.referring_clinician) : ""}${v.referral_reason ? " — " + esc(v.referral_reason) : ""}${v.referral_letter ? ` · <a href="${esc(v.referral_letter)}" target="_blank" style="text-decoration:underline">referral letter</a>` : ""}</div>` : ""}
            ${locked ? '<div class="liveinfo ok">This consultation is completed and read-only.</div>' : ""}
            ${c.status === "Awaiting Lab" ? '<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Waiting for lab results. You can keep working on this consultation meanwhile.</div>' : ""}
            <div class="card" style="padding:20px 24px">
                <div class="card__head" style="margin-bottom:14px"><h3>Triage${t ? ` · ${timeOf(t.triage_datetime)}` : ""} ${t ? `<span class="tag tag--${esc(t.triage_priority)}">${esc(t.triage_priority)}</span>` : ""}</h3>
                    ${t && t.chief_complaint ? `<span class="meta">Complaint: ${esc(t.chief_complaint)}</span>` : ""}</div>
                ${t ? `<div class="vitals">${vitals}</div>${t.alerts ? `<div class="liveinfo" style="margin:12px 0 0">⚠ ${esc(t.alerts.replace(/\n/g, "; "))}</div>` : ""}${t.triage_notes ? `<div class="printnote" style="margin-top:10px">Nurse: ${esc(t.triage_notes)}</div>` : ""}` : empty("No triage recorded for this visit.")}
            </div>
            ${tbBar(c.tb_screening, locked)}
            <div class="ws">
                <div class="card" id="ws-form">
                    <div class="subtabs" id="subtabs">
                        <button class="subtab on" data-p="history">History</button>
                        <button class="subtab" data-p="exam">Examination</button>
                        <button class="subtab" data-p="invest">Investigations <span class="dotc" id="c-lab" style="display:none"></span></button>
                        <button class="subtab" data-p="dx">Diagnosis <span class="dotc" id="c-dx" style="display:none"></span></button>
                        <button class="subtab" data-p="mgmt">Management</button>
                        <button class="subtab" data-p="rx">Prescription <span class="dotc" id="c-rx" style="display:none"></span></button>
                        <button class="subtab" data-p="ref">Referral &amp; Follow-up</button>
                        <button class="subtab" data-p="inc">Accident / Incident <span class="dotc" id="c-inc" style="display:none"></span></button>
                    </div>
                    <fieldset id="fs" style="border:0;padding:0;margin:0;min-width:0" ${locked ? "disabled" : ""}>
                    <div class="subpanel on" id="sp-history">
                        ${field("presenting_complaint", "Presenting complaint", { type: "textarea", rows: 2, value: c.presenting_complaint })}
                        ${field("history_of_presenting_illness", "History of presenting illness", { type: "textarea", rows: 5, value: c.history_of_presenting_illness })}
                        ${field("review_of_systems", "Review of systems", { type: "textarea", rows: 3, value: c.review_of_systems })}
                        <div class="subhead">Background</div>
                        <div class="grid-2">
                            ${field("past_medical_history", "Past medical / surgical history", { type: "textarea", rows: 3, value: c.past_medical_history })}
                            ${field("current_medication", "Current medication", { type: "textarea", rows: 3, value: c.current_medication })}
                            ${field("drug_allergies", "Drug allergies", { type: "textarea", rows: 2, value: c.drug_allergies })}
                            ${field("family_history", "Family history", { type: "textarea", rows: 2, value: c.family_history })}
                            ${field("social_history", "Social history", { type: "textarea", rows: 2, value: c.social_history, help: "Smoking, alcohol…" })}
                            ${isEmp ? field("occupational_history", "Work exposure", { type: "textarea", rows: 2, value: c.occupational_history, help: "Farm section, chemicals handled, PPE use" }) : ""}
                        </div>
                    </div>
                    <div class="subpanel" id="sp-exam">
                        ${field("general_examination", "General examination", { type: "textarea", rows: 5, value: c.general_examination })}
                        ${field("systemic_examination", "Systemic examination", { type: "textarea", rows: 7, value: c.systemic_examination })}
                    </div>
                    <div class="subpanel" id="sp-invest">
                        ${field("investigations_notes", "Investigation notes / findings", { type: "textarea", rows: 3, value: c.investigations_notes })}
                        <div class="subhead">Lab requests</div>
                        ${locked ? "" : `<div class="field"><input class="input" id="lab-add" placeholder="Search a test to request (e.g. malaria, urinalysis, HIV)…"></div>`}
                        <div id="lab-rows"></div>
                        <div class="subhead">Lab results for this visit</div>
                        <div id="lab-results"></div>
                    </div>
                    <div class="subpanel" id="sp-dx">
                        ${locked ? "" : `<div class="field"><input class="input" id="dx-add" placeholder="Search or add a diagnosis…"></div>`}
                        <div id="dx-rows"></div>
                        ${field("impression", "Impression", { type: "textarea", rows: 3, value: c.impression, placeholder: "Your own impression of the diagnosis, e.g. while lab results are pending or the sample is at an external laboratory", help: "Can stand in for a diagnosis until the results are back." })}
                        ${isEmp ? field("work_related", "Work-related condition / injury on duty", { type: "checkbox", value: c.work_related }) : ""}
                    </div>
                    <div class="subpanel" id="sp-mgmt">
                        ${field("management_plan", "Management plan", { type: "textarea", rows: 6, value: c.management_plan })}
                        <div class="grid-2">
                            ${field("procedures_done", "Procedures done", { type: "textarea", rows: 3, value: c.procedures_done })}
                            ${field("patient_advice", "Advice given to patient", { type: "textarea", rows: 3, value: c.patient_advice })}
                        </div>
                    </div>
                    <div class="subpanel" id="sp-rx">
                        <div id="rx-allergy"></div>
                        ${locked ? "" : `<div class="field"><input class="input" id="rx-add" placeholder="Search a medicine to prescribe…"></div>`}
                        <div id="rx-rows"></div>
                        <div id="proc-box"></div>
                    </div>
                    <div class="subpanel" id="sp-ref">
                        ${field("refer_out", "Refer to another facility", { type: "checkbox", value: c.refer_out })}
                        <div id="ref-box" style="display:${c.refer_out ? "block" : "none"}">
                            <div class="grid-2">
                                ${field("referral_facility", "Facility", { value: c.referral_facility, placeholder: "Type to search or add" })}
                                ${field("referral_urgency", "Urgency", { type: "select", options: ["Routine", "Urgent", "Emergency"], value: c.referral_urgency || "Routine" })}
                            </div>
                            ${field("referral_reason", "Reason for referral", { type: "textarea", rows: 2, value: c.referral_reason })}
                            ${field("referral_notes", "Clinical notes for the receiving facility", { type: "textarea", rows: 3, value: c.referral_notes })}
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
                    <div class="subpanel" id="sp-inc"><div id="inc-box"></div></div>
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

    const unsentTest = () => (state.lab || []).some((r) => !r.lab_test);
    const TB_OPTIONS = [[1, "Presumed TB"], [2, "No Signs"], [3, "On TB Treatment"], [4, "Not Done"]];
    function tbBar(current, locked) {
        const code = current ? Number(String(current)[0]) : 0;
        return `<div class="tbbar ${code ? "" : "required"}" id="tbbar">
            <div class="tbbar__head"><h3>TB Screening <span style="color:var(--bad)">*</span></h3>
                <span>${code === 1 && unsentTest() ? '<b style="color:var(--bad)">Sputum test is in your lab requests: press Send to Lab</b>' : code ? "Recorded" : "Required for every patient before the consultation can be closed"}</span></div>
            <div class="tbbar__opts">${TB_OPTIONS.map(([n, label]) => `<button class="tbopt ${code === n ? "on" : ""} ${n === 1 ? "alert" : ""}" data-tb="${n}" ${locked ? "disabled" : ""}>
                <span class="tbopt__n">${n}</span>${label}</button>`).join("")}</div>
        </div>`;
    }

    async function chooseTb(code) {
        const c = ws.consultation;
        if (Number(String(c.tb_screening || "0")[0]) === code) return;
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
        await save(false); // keep anything typed so far
        const r = await call("consultation.set_tb_screening", { name: c.name, code });
        toast(code === 1 ? "Presumed TB recorded. Sputum test added to the lab requests: press Send to Lab." : "TB screening recorded");
        renderWorkspace(await call("consultation.workspace", { visit: ws.visit.name }));
        if (code === 1) { const tab = $(".subtab[data-p=invest]"); if (tab) tab.click(); }
    }

    function bindWorkspace(root, locked, isEmp) {
        $$("[data-tb]", root).forEach((b) => b.addEventListener("click", () => chooseTb(Number(b.dataset.tb))));
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

        renderLab(); renderDx(); renderRx(); renderLabResults(); loadIncidents(locked, isEmp);
        Desk.procedurePicker($("#proc-box", root), state.proc, { locked, onChange: () => (dirty = true) });
        renderTimeline(ws.history);
        $("#tl-all", root).addEventListener("click", async () => renderTimeline(await call("consultation.patient_timeline", { patient: ws.patient.name })));
        refreshActions();

        if (!locked) {
            Desk.facilityField($("[data-f=referral_facility]", root));
            suggest($("#lab-add"), {
                fetch: (q) => M.test_types.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.category.toLowerCase().includes(q.toLowerCase())).slice(0, 12),
                render: (t) => ({ main: t.name, sub: `${t.category} · ${t.performed_where}` }),
                onPick: (t) => { addLab(t); $("#lab-add").value = ""; },
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
                render: (i) => ({ main: i.item_name, sub: [i.strength, Number(i.price) ? `KSh ${i.price}${Number(i.course_qty) > 1 ? " per course of " + i.course_qty : ""}` : "no price set"].filter(Boolean).join(" · ") }),
                onPick: (i) => { addRx(i); $("#rx-add").value = ""; },
                allowNew: async (name) => {
                    const item = await call("consultation.add_drug", { drug_name: name });
                    toast(`${item.item_name} added to the medicine list`);
                    return item;
                },
            });
        }
        $("#save", root).addEventListener("click", () => save(true));
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
            const level = r.result === "Positive" || r.result === "Abnormal" ? "bad" : r.result ? "good" : "mute";
            return `<div class="linebox ${sent ? "locked" : ""}"><div class="linebox__row">
                <div><b style="color:var(--ink)">${esc(r.test_type)}</b> <span class="printnote">${esc(t.category || "")}${t.performed_where === "External" ? " · sent to external facility" : ""}</span>
                    ${t.requires_consent ? pill("Consent required", "warn") : ""}</div>
                <div style="display:flex;gap:10px;align-items:center">
                    ${sent ? `${pill(r.lab_status || "Sent", r.lab_status === "Resulted" ? "good" : "info")} ${r.result ? pill(r.result, level) : ""}`
                        : `<select class="input" style="width:110px;padding:6px 10px" data-lab="${i}" data-k="urgency">${["Routine", "Urgent"].map((u) => `<option ${u === r.urgency ? "selected" : ""}>${u}</option>`).join("")}</select>
                           <button class="iconx" data-lab-del="${i}" title="Remove">×</button>`}
                </div></div>
                ${sent ? "" : `<input class="input" style="margin-top:10px" placeholder="Clinical notes for the lab (optional)" data-lab="${i}" data-k="clinical_notes" value="${esc(r.clinical_notes || "")}">`}
            </div>`;
        }).join("") : empty("No tests requested.");
        $$("[data-lab]", el).forEach((inp) => inp.addEventListener("input", () => (state.lab[inp.dataset.lab][inp.dataset.k] = inp.value)));
        $$("[data-lab-del]", el).forEach((b) => b.addEventListener("click", () => { state.lab.splice(Number(b.dataset.labDel), 1); dirty = true; renderLab(); refreshActions(); }));
        const n = state.lab.length; $("#c-lab").style.display = n ? "" : "none"; $("#c-lab").textContent = n;
    }
    function renderLabResults() {
        const el = $("#lab-results");
        if (!ws.lab_tests.length) { el.innerHTML = '<div class="printnote">Nothing sent to the lab yet.</div>'; return; }
        el.innerHTML = ws.lab_tests.map((t) => `<div class="linebox"><div class="linebox__row">
            <b style="color:var(--ink)">${esc(t.test_type)}</b>
            <div>${pill(t.status, t.status === "Resulted" ? "good" : "info")} ${t.interpretation ? pill(t.interpretation, ["Positive", "Abnormal"].includes(t.interpretation) ? "bad" : "good") : ""}</div></div>
            ${t.status === "Resulted" || t.results.some((r) => r.value) ? `<table class="rtable" style="margin-top:10px"><tr><th>Parameter</th><th>Result</th><th>Reference</th><th></th></tr>
                ${t.results.filter((r) => r.value).map((r) => `<tr><td>${esc(r.parameter)}</td><td><b>${esc(r.value)}</b> ${esc(r.unit || "")}</td><td class="printnote">${esc(r.reference || "")}</td><td class="flagcell ${esc(r.flag || "")}">${esc(r.flag || "")}</td></tr>`).join("")}</table>` : ""}
            ${t.result_comments ? `<div class="printnote" style="margin-top:8px">Lab comment: ${esc(t.result_comments)}</div>` : ""}
            ${t.external_report ? `<div style="margin-top:8px"><a href="${esc(t.external_report)}" target="_blank" class="btn btn--sm">Open external report</a></div>` : ""}
        </div>`).join("");
    }

    // ---- diagnoses
    function addDx(name) {
        if (state.dx.some((r) => r.diagnosis === name)) return toast(`${name} is already listed`, "warn");
        state.dx.push({ diagnosis: name, diagnosis_type: state.dx.length ? "Provisional" : "Provisional", notes: "" });
        dirty = true; renderDx(); refreshActions();
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
        $$("[data-dx-del]", el).forEach((b) => b.addEventListener("click", () => { state.dx.splice(Number(b.dataset.dxDel), 1); dirty = true; renderDx(); refreshActions(); }));
        const n = state.dx.length; $("#c-dx").style.display = n ? "" : "none"; $("#c-dx").textContent = n;
        if (locked()) $$("#dx-rows input,#dx-rows select,#dx-rows button").forEach((x) => (x.disabled = true));
    }

    // ---- prescriptions
    function addRx(item) {
        // a medicine priced per course starts with the course quantity (3 tablets, 5 days...) already filled in
        const course = Number(item.course_qty) > 1 ? Number(item.course_qty) : "";
        state.rx.push({ drug: item.name, drug_name: item.item_name, dose: item.strength || "", route: "Oral", frequency: "", duration_days: "", quantity: course, instructions: "", _qtyTouched: !!course });
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
                <div class="field"><label>Quantity <span class="req">*</span></label><input type="number" min="0" step="any" data-rx="${i}" data-k="quantity" value="${esc(r.quantity ?? "")}"></div>
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

    const locked = () => ws.consultation.status === "Completed";

    // ---- timeline
    function renderTimeline(rows) {
        const el = $("#timeline");
        el.innerHTML = rows.length ? rows.map((h, i) => `<div class="tl" data-tl="${i}">
            <div class="tl__date">${esc(dateOf(h.consultation_date))} · ${esc(h.doctor_name || "")}</div>
            <div class="tl__dx">${(h.incidents || []).length ? `<span class="tag tag--Emergency">${esc(h.incidents[0].report_type)}</span> ` : ""}${h.diagnoses.length ? h.diagnoses.map((d) => esc(d.diagnosis)).join(", ") : h.impression ? `<i>Impression:</i> ${esc(h.impression)}` : "<i>No diagnosis</i>"}</div>
            <div class="printnote">${esc(h.presenting_complaint || "")}</div>
            <div class="tl__detail">
                ${h.management_plan ? `<div><b>Management:</b> ${esc(h.management_plan)}</div>` : ""}
                ${h.prescriptions.length ? `<div><b>Prescribed:</b> ${h.prescriptions.map((x) => esc(x.drug_name || x.drug) + (x.dose ? " " + esc(x.dose) : "") + (x.frequency ? " " + esc(x.frequency) : "") + (x.duration_days ? " × " + x.duration_days + "d" : "")).join("; ")}</div>` : ""}
                ${h.labs.length ? `<div><b>Labs:</b> ${h.labs.map((x) => esc(x.test_type) + ": " + esc(x.interpretation || x.status)).join("; ")}</div>` : ""}
                ${h.refer_out ? `<div><b>Referred to:</b> ${esc(h.referral_facility || "")}</div>` : ""}
                ${h.sick_leave_days ? `<div><b>Sick-off:</b> ${h.sick_leave_days} days</div>` : ""}
                ${h.work_related ? `<div><b>Work-related</b></div>` : ""}
                ${(h.incidents || []).map((x) => `<div style="color:var(--bad)"><b>${esc(x.report_type)}:</b> ${esc(x.severity)}${x.injury_type ? " · " + esc(x.injury_type) : ""}</div>`).join("")}
            </div></div>`).join("") : empty("First visit — no earlier consultations.");
        $$(".tl", el).forEach((t) => t.addEventListener("click", () => t.classList.toggle("open")));
    }

    // ---- accident / incident
    const CAUSES = ["", "Fall", "Machinery / equipment", "Cut / sharps / needle-stick", "Chemical exposure", "Burn / scald", "Road traffic", "Struck by object", "Animal / insect bite", "Heat / dehydration", "Assault", "Other"];
    const OUTCOMES = ["", "Treated and discharged", "Sick-off", "Light duty", "Referred out", "Admitted", "Fatal"];
    const ifield = (...a) => field(...a).replace(/data-f=/g, "data-i=");
    const iread = (root) => { const o = {}; $$("[data-i]", root).forEach((el) => (o[el.dataset.i] = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value)); return o; };
    let incidents = [], incLocked = false, incEmp = false;

    async function loadIncidents(locked, isEmp) {
        incLocked = locked; incEmp = isEmp;
        incidents = await call("incident.for_visit", { visit: ws.visit.name }, { quiet: true });
        renderIncidents();
    }
    function renderIncidents(editing) {
        const box = $("#inc-box"); if (!box) return;
        const n = incidents.length; $("#c-inc").style.display = n ? "" : "none"; $("#c-inc").textContent = n;
        const sevCls = { Minor: "good", Moderate: "warn", Severe: "bad", Fatal: "bad" };
        box.innerHTML = `
            <div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Record any accident, incident or near miss linked to this visit. It is saved straight away, appears in the patient's history and feeds the monthly Accidents &amp; Incidents report.</div>
            ${incidents.map((x) => `<div class="linebox"><div class="linebox__row">
                <div><b style="color:var(--ink)">${esc(x.report_type)}</b> ${pill(x.severity, sevCls[x.severity] || "info")} ${x.work_related ? pill("Work-related", "bad") : ""}
                    <span class="printnote">${esc(dateOf(x.incident_date))}${x.incident_time ? " " + esc(String(x.incident_time).slice(0, 5)) : ""}${x.location ? " · " + esc(x.location) : ""}</span></div>
                <div>${incLocked ? "" : `<button class="btn btn--sm" data-inc-edit="${esc(x.name)}">Edit</button> <button class="iconx" data-inc-del="${esc(x.name)}" title="Delete">×</button>`}</div></div>
                <div class="printnote" style="margin-top:6px">${esc(x.name)} · ${[x.cause, x.injury_type, x.body_part].filter(Boolean).map(esc).join(" · ") || "—"}${x.outcome ? " · " + esc(x.outcome) : ""}</div>
                <div style="margin-top:6px">${esc(x.description || "")}</div></div>`).join("") || (editing ? "" : empty("No accident or incident recorded for this visit."))}
            <div id="inc-form">${editing ? incForm(editing) : incLocked ? "" : '<button class="btn btn--signal" id="inc-new">+ Record accident / incident</button>'}</div>`;
        $("#inc-new")?.addEventListener("click", () => renderIncidents({}));
        $$("[data-inc-edit]", box).forEach((b) => b.addEventListener("click", () => renderIncidents(incidents.find((x) => x.name === b.dataset.incEdit))));
        $$("[data-inc-del]", box).forEach((b) => b.addEventListener("click", async () => {
            if (!confirm("Delete this accident / incident record?")) return;
            await call("incident.remove", { name: b.dataset.incDel }); toast("Record deleted"); await loadIncidents(incLocked, incEmp);
        }));
        if (editing) {
            const f = $("#inc-form");
            Desk.facilityField($("[data-i=referral_destination]", f));
            $("#inc-cancel").addEventListener("click", () => renderIncidents());
            $("#inc-save").addEventListener("click", async () => {
                const data = iread(f);
                if (!data.description.trim()) return toast("Describe what happened", "warn");
                if (!data.incident_date) return toast("Enter the date of the event", "warn");
                try {
                    await call("incident.save", { visit: ws.visit.name, data, name: editing.name || undefined });
                    toast("Accident / incident recorded");
                    if (data.work_related) { const w = $("[data-f=work_related]"); if (w) w.checked = true; }
                    await loadIncidents(incLocked, incEmp);
                } catch (e) { /* shown by call() */ }
            });
        }
    }
    function incForm(x) {
        const today = new Date().toISOString().slice(0, 10);
        const emp = incEmp;
        return `<div class="card" style="padding:16px 18px;margin-top:12px"><div class="card__head"><h3>${x.name ? "Edit " + esc(x.name) : "New accident / incident"}</h3></div>
            <div class="grid-2">
                ${ifield("report_type", "Type", { type: "select", options: ["Accident", "Incident", "Near Miss"], value: x.report_type || "Accident" })}
                ${ifield("severity", "Severity", { type: "select", options: ["Minor", "Moderate", "Severe", "Fatal"], value: x.severity || "Minor" })}
                ${ifield("incident_date", "Date of event", { type: "date", value: x.incident_date || today, attrs: `max="${today}"` })}
                ${ifield("incident_time", "Time of event", { type: "time", value: x.incident_time ? String(x.incident_time).slice(0, 5) : "" })}
                ${ifield("location", "Where it happened", { value: x.location, placeholder: "Farm section, packhouse, road, home…" })}
                ${ifield("cause", "Mechanism / cause", { type: "select", options: CAUSES.map((c) => ({ value: c, label: c || "Select…" })), value: x.cause })}
                ${ifield("injury_type", "Type of injury", { value: x.injury_type, placeholder: "Laceration, fracture, sprain, burn…" })}
                ${ifield("body_part", "Body part affected", { value: x.body_part })}
            </div>
            ${ifield("description", "What happened", { type: "textarea", rows: 3, value: x.description, required: true })}
            <div class="grid-2">
                ${ifield("witness", "Witness(es)", { value: x.witness })}
                ${ifield("reported_to", "Reported to (supervisor)", { value: x.reported_to })}
            </div>
            ${emp || x.work_related ? ifield("work_related", "Work-related (happened on duty)", { type: "checkbox", value: x.work_related == null ? 1 : x.work_related }) : ifield("work_related", "Work-related (happened on duty)", { type: "checkbox", value: x.work_related })}
            <div class="subhead">Treatment and outcome</div>
            ${ifield("stabilization_steps", "First aid / treatment given", { type: "textarea", rows: 2, value: x.stabilization_steps })}
            <div class="grid-2">
                ${ifield("outcome", "Outcome", { type: "select", options: OUTCOMES.map((c) => ({ value: c, label: c || "Select…" })), value: x.outcome })}
                ${ifield("lost_days", "Days lost (sick-off)", { type: "number", value: x.lost_days || "", attrs: 'min="0"' })}
                ${ifield("referral_destination", "Referred to", { value: x.referral_destination, placeholder: "Type to search or add" })}
                ${ifield("accompanied_by_co", "Accompanied by an escort / clinician", { type: "checkbox", value: x.accompanied_by_co })}
            </div>
            <div class="subhead">Review (can be completed later)</div>
            ${ifield("root_cause", "Root cause", { type: "textarea", rows: 2, value: x.root_cause })}
            ${ifield("corrective_actions", "Corrective / preventive actions", { type: "textarea", rows: 2, value: x.corrective_actions })}
            <div class="grid-2">
                ${ifield("doshmis_status", "DOSHS / statutory report", { type: "select", options: ["Not Required", "Pending", "In Progress", "Filed"], value: x.doshmis_status || "Not Required" })}
                ${ifield("insurance_status", "Insurance / compensation", { type: "select", options: ["Not Applicable", "Ongoing", "Settled"], value: x.insurance_status || "Not Applicable" })}
                ${ifield("status", "Report status", { type: "select", options: ["Open", "Under Review", "Closed"], value: x.status || "Open" })}
            </div>
            <div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn--primary" id="inc-save">Save record</button><button class="btn" id="inc-cancel">Cancel</button></div></div>`;
    }

    // ---- actions
    function needTb() {
        if (ws.consultation.tb_screening) return false;
        toast("Record the TB screening (1–4) first", "warn");
        const bar = $("#tbbar"); if (bar) bar.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
    }

    function refreshActions() {
        const box = $("#actions");
        if (locked()) { box.innerHTML = ""; return; }
        const unsent = state.lab.some((r) => !r.lab_test);
        const hasRx = state.rx.length > 0;
        box.innerHTML = `
            ${unsent ? '<button class="btn btn--signal" id="a-lab">Send to Lab →</button>' : ""}
            ${hasRx ? `<button class="btn ${unsent ? "" : "btn--primary"}" id="a-rx">Send to Pharmacy →</button>`
                : `<button class="btn ${unsent ? "" : "btn--primary"}" id="a-done">Complete consultation ✓</button>`}`;
        $("#a-lab")?.addEventListener("click", () => act("send_to_lab", "Sent to the lab"));
        $("#a-rx")?.addEventListener("click", () => {
            if (state.lab.some((r) => !r.lab_test)) return toast("Send the new lab requests first, or remove them.", "warn");
            if (needTb()) return;
            act("send_to_pharmacy", "Sent to the pharmacy");
        });
        $("#a-done")?.addEventListener("click", () => {
            if (state.lab.some((r) => !r.lab_test)) return toast("Send the new lab requests first, or remove them.", "warn");
            if (needTb()) return;
            act("complete", "Consultation completed");
        });
    }

    function collect() {
        const data = read($("#ws-form"));
        // unchecked/absent boxes come through as 0; empty date strings are cleaned server side
        data.lab_requests = state.lab.map(({ test_type, urgency, clinical_notes, lab_test }) => ({ test_type, urgency, clinical_notes, lab_test }));
        data.diagnoses = state.dx.map(({ diagnosis, diagnosis_type, notes }) => ({ diagnosis, diagnosis_type, notes }));
        data.procedures = state.proc.map(({ procedure, qty }) => ({ procedure, qty }));
        data.prescriptions = state.rx.map(({ drug, dose, route, frequency, duration_days, quantity, instructions }) => ({ drug, dose, route, frequency, duration_days, quantity, instructions }));
        return data;
    }

    async function save(showToast) {
        await call("consultation.save", { name: ws.consultation.name, data: collect() });
        dirty = false;
        $("#saved-note").textContent = "Saved " + new Date().toTimeString().slice(0, 5);
        if (showToast) toast("Draft saved");
    }

    async function act(action, message) {
        const btns = $$(".actionbar button"); btns.forEach((b) => (b.disabled = true));
        try {
            await call("consultation.action", { name: ws.consultation.name, action, data: collect() });
            dirty = false;
            toast(message);
            // back to the queue so the next patient can be seen; the patient returns here once the lab is done
            history.replaceState(null, "", location.pathname);
            showQueue();
        } catch (e) {
            btns.forEach((b) => (b.disabled = false));
            // reload so lab rows already created on the server show as sent
            if (e.handled) { try { const fresh = await call("consultation.workspace", { visit: ws.visit.name }, { quiet: true }); if (fresh.consultation.lab_requests.some((r) => r.lab_test) !== ws.consultation.lab_requests.some((r) => r.lab_test)) renderWorkspace(fresh); } catch (_) { /* ignore */ } }
        }
    }

    // ============================================================ start
    const start = location.hash.replace("#/", "");
    if (start) { try { renderWorkspace(await call("consultation.workspace", { visit: start })); } catch (e) { showQueue(); } }
    else await loadAll();
    Desk.poll(() => { if ($("#view-ws").style.display === "none") loadAll(); });
})();
