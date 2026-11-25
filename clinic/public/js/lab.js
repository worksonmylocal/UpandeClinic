/* Laboratory page */
(async function () {
    const { call, $, $$, esc, timeOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, banner, masters, COLORS } = Desk;

    await Desk.shell({
        page: "lab",
        eyebrow: "Northlake Medical Centre · Laboratory",
        title: "Laboratory",
        sub: "Collect samples, enter results and return them to the doctor",
        tools: `<button class="btn btn--primary" id="walk-in">＋ Walk-in / referred request</button>
                <button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => { if (tab === "insights") loadInsights(); else if (tab === "month") loadMonth(); });
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });
    $("#walk-in").addEventListener("click", walkIn);

    const M = await masters();
    let dash, filter = "all";
    const reportUrl = (visit) => `/clinic/report?visit=${encodeURIComponent(visit)}`;
    const referredPill = (r) => (r.lab_only ? " " + pill("Referred" + (r.referred_by ? " · " + r.referred_by : ""), "info") : "");
    const POSITIVE = ["positive", "reactive", "present", "seen", "detected"];
    const NEGATIVE = ["negative", "non-reactive", "nonreactive", "absent", "not seen", "not detected", "nil"];

    // ------------------------------------------------------------ dashboard
    async function loadAll() {
        dash = await call("lab.dashboard");
        const k = dash.kpis;
        kpis($("#kpis"), [
            { label: "Tests Pending", value: k.pending, cls: k.pending ? "warn" : "", unit: k.pending ? `Longest wait ${Desk.duration(k.longest_wait)}` : "Bench is clear" },
            { label: "Urgent", value: k.urgent, cls: k.urgent ? "bad" : "", unit: `${k.in_progress} sample(s) already collected` },
            { label: "Resulted Today", value: k.resulted_today, cls: "good", unit: `Avg turnaround ${Desk.duration(k.avg_tat)}` },
            { label: "Positivity Today", value: `${k.positivity}<span style="font-size:16px">%</span>`, cls: k.positivity >= 30 ? "warn" : "", unit: `${k.positive_today} positive · ${k.abnormal_today} abnormal` },
            { label: "Out at External Labs", value: k.external_out, cls: k.external_out ? "info" : "", unit: "Awaiting reports" },
            { label: "Requested Today", value: k.requested_today, unit: `${Desk.split(k.employees_today, k.community_today)}` },
        ]);
        renderFilters(); renderQueue(); renderExternal(); renderResulted();
        const badge = $("#ext-badge");
        badge.style.display = k.external_out ? "" : "none"; badge.textContent = k.external_out;
        if ($("#tab-insights").classList.contains("on")) loadInsights();
        if ($("#tab-month").classList.contains("on")) loadMonth();
    }

    function renderFilters() {
        const cats = [...new Set(dash.queue.map((r) => r.category))];
        const opts = [["all", "All"], ["urgent", "Urgent"], ["collected", "Sample collected"], ["external", "External"], ...cats.map((c) => ["cat:" + c, c])];
        $("#lab-filters").innerHTML = opts.map(([k, l]) => `<button class="chipsel ${filter === k ? "on" : ""}" data-k="${esc(k)}">${esc(l)}</button>`).join("");
        $$("#lab-filters .chipsel").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.k; renderFilters(); renderQueue(); }));
    }
    $("#lab-search").addEventListener("input", () => renderQueue());

    function renderQueue() {
        const q = $("#lab-search").value.trim().toLowerCase();
        const rows = dash.queue.filter((r) => {
            if (q && !(`${r.patient_name} ${r.test_type} ${r.visit}`.toLowerCase().includes(q))) return false;
            if (filter === "urgent") return r.urgency === "Urgent";
            if (filter === "collected") return r.status === "Sample Collected";
            if (filter === "external") return r.performed_where === "External";
            if (filter.startsWith("cat:")) return r.category === filter.slice(4);
            return true;
        });
        $("#queue").innerHTML = rows.length ? `<table class="dtable"><tr><th>Test</th><th>Patient</th><th>Requested by</th><th>Waiting</th><th>Status</th><th></th></tr>
            ${rows.map((r) => `<tr>
                <td><b style="color:var(--ink)">${esc(r.test_type)}</b> ${r.urgency === "Urgent" ? '<span class="tag tag--Emergency">Urgent</span>' : ""}<br>
                    <span class="printnote">${esc(r.category)}${r.performed_where === "External" ? " · external" : ""}</span></td>
                <td>${esc(r.patient_name)} ${typeTag(r.patient_type)}${referredPill(r)}<br><span class="printnote">${esc(ageSex(r))}</span></td>
                <td>${r.lab_only ? "Walk-in / referral" : esc(r.requested_by_name || "—")}${r.clinical_notes ? `<br><span class="printnote">${esc(r.clinical_notes)}</span>` : ""}</td>
                <td>${wait(r.wait_minutes, 30, 90)}</td>
                <td>${pill(r.status, r.status === "Sample Collected" ? "info" : "warn")}</td>
                <td class="num"><button class="btn btn--primary btn--sm" data-open="${esc(r.name)}">${r.status === "Requested" ? "Process" : "Enter results"}</button></td></tr>`).join("")}</table>`
            : empty(dash.queue.length ? "No tests match this filter." : "No tests waiting. Nice work.");
        $$("#queue [data-open]").forEach((b) => b.addEventListener("click", () => openTest(b.dataset.open)));
    }

    function renderExternal() {
        $("#external").innerHTML = dash.external.length ? `<table class="dtable"><tr><th>Test</th><th>Patient</th><th>Facility</th><th>Sent</th><th></th></tr>
            ${dash.external.map((r) => `<tr><td><b style="color:var(--ink)">${esc(r.test_type)}</b><br><span class="printnote">${esc(r.category)}</span></td>
                <td>${esc(r.patient_name)} ${typeTag(r.patient_type)}</td><td>${esc(r.external_facility || "—")}</td>
                <td>${pill(r.days_out ? r.days_out + " d ago" : "Today", r.days_out >= 3 ? "bad" : "mute")}</td>
                <td class="num"><a class="btn btn--sm" target="_blank" href="/clinic/referral?test=${encodeURIComponent(r.name)}" title="Letter to send with the sample">Referral letter</a> <button class="btn btn--signal btn--sm" data-open="${esc(r.name)}">Receive result</button></td></tr>`).join("")}</table>`
            : empty("Nothing is out at an external facility.");
        $$("#external [data-open]").forEach((b) => b.addEventListener("click", () => openTest(b.dataset.open)));
    }

    function renderResulted() {
        $("#resulted").innerHTML = dash.resulted.length ? `<table class="dtable"><tr><th>Time</th><th>Test</th><th>Patient</th><th>Result</th><th>By</th><th></th></tr>
            ${dash.resulted.map((r) => `<tr><td>${timeOf(r.resulted_on)}</td><td><b style="color:var(--ink)">${esc(r.test_type)}</b></td>
                <td>${esc(r.patient_name)} ${typeTag(r.patient_type)}</td>
                <td>${r.interpretation ? pill(r.interpretation, ["Positive", "Abnormal"].includes(r.interpretation) ? "bad" : "good") : "—"}${referredPill(r)}</td>
                <td>${esc(r.technician_name || "")}</td>
                <td class="num">${r.lab_only ? `<a class="btn btn--sm" target="_blank" href="${reportUrl(r.visit)}">Print report</a> ` : ""}<button class="btn btn--link btn--sm" data-open="${esc(r.name)}">View</button></td></tr>`).join("")}</table>`
            : empty("No results released yet today.");
        $$("#resulted [data-open]").forEach((b) => b.addEventListener("click", () => openTest(b.dataset.open)));
    }

    async function loadMonth() {
        const d = await call("lab.month_results");
        const s = d.summary;
        $("#month-meta").textContent = d.month;
        kpis($("#month-kpis"), [
            { label: "Resulted This Month", value: s.total, cls: "good", unit: d.month },
            { label: "Positive", value: s.positive, cls: s.positive ? "bad" : "", unit: `${s.abnormal} abnormal` },
            { label: "Employees / Community", value: `${s.employees} <span style="font-size:14px;color:var(--ink-mute)">/ ${s.community}</span>`, unit: "Patients tested" },
            { label: "From External Labs", value: s.external, cls: "info", unit: "Reports received" },
        ]);
        $("#resulted-month").innerHTML = d.rows.length ? `<table class="dtable"><tr><th>Date</th><th>Test</th><th>Patient</th><th>Result</th><th>By</th><th></th></tr>
            ${d.rows.map((r) => `<tr><td>${esc(Desk.dateOf(r.resulted_on).slice(5))} ${timeOf(r.resulted_on)}</td><td><b style="color:var(--ink)">${esc(r.test_type)}</b></td>
                <td>${esc(r.patient_name)} ${typeTag(r.patient_type)}</td>
                <td>${r.interpretation ? pill(r.interpretation, ["Positive", "Abnormal"].includes(r.interpretation) ? "bad" : "good") : "—"}${referredPill(r)}</td>
                <td>${esc(r.technician_name || "")}</td>
                <td class="num">${r.lab_only ? `<a class="btn btn--sm" target="_blank" href="${reportUrl(r.visit)}">Print report</a> ` : ""}<button class="btn btn--link btn--sm" data-open="${esc(r.name)}">View</button></td></tr>`).join("")}</table>`
            : empty("No results released yet this month.");
        $$("#resulted-month [data-open]").forEach((b) => b.addEventListener("click", () => openTest(b.dataset.open)));
    }

    async function loadInsights() {
        const d = await call("lab.insights");
        chart("cat-chart", { type: "bar", data: { labels: d.by_category.map((r) => r.label), datasets: Desk.stackedDatasets(d.by_category) }, options: { ...Desk.stackedOptions, plugins: { legend: { display: false } } } });
        chart("day-chart", { type: "line", data: { labels: d.by_day.map((r) => r.day.slice(5)), datasets: [{ label: "Tests", data: d.by_day.map((r) => Number(r.tests)), borderColor: COLORS.ink, backgroundColor: "rgba(10,10,10,0.06)", fill: true, tension: 0.35, pointRadius: 3 }] }, options: { plugins: { legend: { display: false } } } });
        $("#top-month-meta").textContent = `${d.top_month.reduce((n, r) => n + Number(r.total), 0)} tests requested this month`;
        hbars($("#top-month"), d.top_month, {
            valueKey: "total",
            wide: true,
            format: (v, r) => `${v} <span style="color:var(--ink-mute)">(${r.employees} emp · ${r.community} com${Number(r.positive) ? " · " + r.positive + " pos" : ""})</span>`,
        });
        const el = $("#positivity");
        el.innerHTML = d.positivity.length ? `<table class="dtable"><tr><th>Test</th><th class="num">Resulted</th><th class="num">Positive</th><th class="num">Employees +</th><th class="num">Community +</th><th style="width:30%">Positivity</th></tr>
            ${d.positivity.map((r) => { const pct = r.resulted ? Math.round(r.positive * 100 / r.resulted) : 0;
                return `<tr><td><b style="color:var(--ink)">${esc(r.label)}</b></td><td class="num">${r.resulted}</td><td class="num">${r.positive}</td>
                <td class="num">${r.employees_positive}</td><td class="num">${r.community_positive}</td>
                <td><div class="hb" style="grid-template-columns:1fr 46px;padding:0;border:0"><div class="hb__lane"><div class="hb__est"></div><div class="hb__act ${pct >= 30 ? "bad" : ""}" style="width:${pct}%"></div></div><div class="hb__pct">${pct}%</div></div></td></tr>`; }).join("")}</table>`
            : empty("No resulted tests in the last 30 days.");
    }

    // ------------------------------------------------------------ test modal
    function flagFor(row, value) {
        value = String(value || "").trim();
        if (!value) return "";
        if (row.result_type === "Numeric") {
            const n = Number(value);
            if (Number.isNaN(n)) return "";
            if (row.normal_low && n < row.normal_low) return "Low";
            if (row.normal_high && n > row.normal_high) return "High";
            return "Normal";
        }
        if (row.result_type === "Qualitative") {
            const v = value.toLowerCase();
            if (POSITIVE.includes(v) || v.startsWith("positive")) return "Positive";
            if (NEGATIVE.includes(v)) return "Negative";
            if (value.startsWith("+")) return "Abnormal";
        }
        return "";
    }

    function resultInput(r) {
        const v = esc(r.value || "");
        if (r.result_type === "Qualitative" && r.options) {
            const opts = r.options.split("\n").map((o) => o.trim()).filter(Boolean);
            return `<select data-res="${esc(r.name)}"><option value=""></option>${opts.map((o) => `<option ${o === r.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        }
        if (r.result_type === "Numeric") return `<input type="number" step="any" data-res="${esc(r.name)}" value="${v}">`;
        return `<input type="text" data-res="${esc(r.name)}" value="${v}">`;
    }

    async function upload(file, docname) {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("is_private", "1");
        fd.append("doctype", "Clinic Lab Test");
        fd.append("docname", docname);
        fd.append("fieldname", "external_report");
        const res = await fetch("/api/method/upload_file", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-Frappe-CSRF-Token": Desk.cfg.csrf } });
        const data = await res.json();
        if (!res.ok) { toast("Upload failed", "error"); const e = new Error("upload"); e.handled = true; throw e; }
        return data.message.file_url;
    }

    async function openTest(name) {
        const t = await call("lab.get_test", { name });
        const done = t.status === "Resulted" || t.status === "Cancelled";
        const external = t.performed_where === "External";
        const steps = external ? ["Requested", "Sample Collected", "Sent to External", "Resulted"] : ["Requested", "Sample Collected", "Resulted"];
        const at = steps.indexOf(t.status);
        const rows = t.results || [];
        // parameters that share a group (e.g. the urine rows of the ANC profile) sit under one expandable heading
        const rowHtml = (r) => `<tr data-row="${esc(r.name)}"${r.param_group ? ` data-grp-row="${esc(r.param_group)}" hidden` : ""}><td${r.param_group ? ' style="padding-left:28px"' : ""}><b style="color:var(--ink)">${esc(r.parameter)}</b></td>
                        <td>${done ? esc(r.value || "—") : resultInput(r)}</td><td>${esc(r.unit || "")}</td><td class="printnote">${esc(r.reference || "")}</td>
                        <td class="flagcell ${esc(r.flag || "")}" id="flag-${esc(r.name)}">${esc(r.flag || "")}</td></tr>`;
        const groupHead = (g) => `<tr class="grp-head" data-grp="${esc(g)}" role="button" tabindex="0" aria-expanded="false"><td colspan="5"><span class="grp-caret">▸</span> <b>${esc(g)}</b> <span class="printnote" data-grp-sum="${esc(g)}"></span></td></tr>`;
        const seenGroups = new Set();
        const rowsHtml = rows.map((r) => {
            const g = r.param_group;
            if (!g || seenGroups.has(g)) return rowHtml(r);
            seenGroups.add(g);
            return groupHead(g) + rowHtml(r);
        }).join("");

        const h = modal({
            title: t.test_type,
            sub: `${esc(t.name)} · ${esc(t.visit)} · requested ${timeOf(t.requested_on)} by ${esc(t.requested_by_name || "—")}`,
            size: "wide",
            body: `${banner(t.patient_card)}
                <div class="stepper">${steps.map((s, i) => `<span class="step ${i < at ? "done" : i === at ? "now" : ""}">${i + 1}. ${s}</span>`).join("")}</div>
                ${t.lab_only ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Lab-only patient${t.referring_facility ? " referred by <b>" + esc(t.referring_facility) + "</b>" : ""}${t.referring_clinician ? " (" + esc(t.referring_clinician) + ")" : ""}. Results are printed for the patient to take back; they do not go to a doctor here.</div>` : ""}
                ${t.clinical_notes ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Doctor's note: ${esc(t.clinical_notes)}</div>` : ""}
                ${t.instructions ? `<div class="printnote" style="margin-bottom:12px">Sample/patient preparation: ${esc(t.instructions)}</div>` : ""}
                ${t.requires_consent ? `<label class="check" style="background:var(--warn-bg);padding:12px 16px;border-radius:12px"><input type="checkbox" data-f="consent_obtained" ${t.consent_obtained ? "checked" : ""} ${done ? "disabled" : ""}> Patient consent given and pre-test counselling done (required before results can be entered)</label>` : ""}
                ${external ? `<div class="subhead">External facility</div><div class="grid-3">
                    ${field("external_facility", "Send to", { value: t.external_facility, placeholder: "Type to search or add", attrs: done ? "disabled" : "" })}
                    ${field("sent_on", "Sent on", { type: "date", value: t.sent_on, attrs: done ? "disabled" : "" })}
                    <div class="field"><label>External report</label>${t.external_report ? `<a class="btn btn--sm" target="_blank" href="${esc(t.external_report)}">Open report</a>` : done ? "<small>None attached</small>" : '<input type="file" id="ext-file" accept=".pdf,.png,.jpg,.jpeg">'}</div></div>` : ""}
                <div class="subhead">Results</div>
                ${rows.length ? `<table class="rtable"><tr><th style="width:26%">Parameter</th><th style="width:26%">Result</th><th>Unit</th><th>Reference</th><th>Flag</th></tr>
                    ${rowsHtml}</table>` : '<div class="printnote">No parameters defined for this test.</div>'}
                <div class="grid-2" style="margin-top:16px">
                    ${field("result_comments", "Comments", { type: "textarea", rows: 2, value: t.result_comments, attrs: done ? "disabled" : "" })}
                    ${field("interpretation", "Overall result", { type: "select", options: ["", "Normal", "Abnormal", "Positive", "Negative", "Inconclusive"], value: t.interpretation, attrs: done ? "disabled" : "", help: "Left blank, it is worked out from the results." })}
                </div>`,
            foot: done ? [{ label: "Close" }, ...(t.status === "Resulted" ? [{ label: "Print report", cls: "btn--primary", onClick: () => { window.open(reportUrl(t.visit), "_blank"); } }] : [])] : [
                { label: "Close" },
                { label: "Cancel test", cls: "btn--danger", onClick: async (hh) => { if (!confirm("Cancel this test?")) return; await submit(hh, "cancel"); } },
                ...(t.status === "Requested" ? [{ label: "Collect sample", onClick: (hh) => submit(hh, "collect", true) }] : []),
                { label: "Save", onClick: (hh) => submit(hh, "save", true) },
                ...(external && t.external_facility ? [{ label: "Referral letter", onClick: () => { window.open("/clinic/referral?test=" + encodeURIComponent(t.name), "_blank"); } }] : []),
                ...(external && t.status !== "Sent to External" ? [{ label: "Send to external facility", cls: "btn--signal", onClick: (hh) => submit(hh, "send_external") }] : []),
                { label: t.lab_only ? "Release results" : "Submit results → Doctor", cls: "btn--primary", onClick: (hh) => submit(hh, "result") },
            ],
        });

        Desk.facilityField(!done && external ? $("[data-f=external_facility]", h.body) : null);
        // live flags
        const byId = Object.fromEntries(rows.map((r) => [r.name, r]));
        // "12 of 19 entered · 2 abnormal" beside each group heading, kept current as results are typed
        const refreshGroups = () => $$("[data-grp-sum]", h.body).forEach((el) => {
            const rs = rows.filter((r) => r.param_group === el.dataset.grpSum);
            const val = (r) => { const i = $(`[data-res="${CSS.escape(r.name)}"]`, h.body); return String(i ? i.value : r.value || "").trim(); };
            const filled = rs.filter((r) => val(r)).length;
            const odd = rs.filter((r) => ["High", "Low", "Abnormal", "Positive"].includes(flagFor(r, val(r)))).length;
            el.innerHTML = `${filled} of ${rs.length} entered${odd ? ` · <b style="color:var(--bad)">${odd} abnormal</b>` : ""}`;
        });
        const toggleGroup = (head) => {
            const open = head.getAttribute("aria-expanded") !== "true";
            head.setAttribute("aria-expanded", open);
            $(".grp-caret", head).textContent = open ? "▾" : "▸";
            $$("[data-grp-row]", h.body).filter((tr) => tr.dataset.grpRow === head.dataset.grp).forEach((tr) => { tr.hidden = !open; });
        };
        $$(".grp-head", h.body).forEach((head) => {
            head.addEventListener("click", () => toggleGroup(head));
            head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(head); } });
        });
        $$("[data-res]", h.body).forEach((inp) => {
            const upd = () => {
                const cell = $(`#flag-${CSS.escape(inp.dataset.res)}`, h.body);
                const f = flagFor(byId[inp.dataset.res], inp.value);
                cell.textContent = f; cell.className = "flagcell " + f;
                refreshGroups();
            };
            inp.addEventListener("input", upd); inp.addEventListener("change", upd);
        });
        refreshGroups();

        async function submit(hh, action, stay) {
            const body = hh.body, data = read(body);
            data.results = $$("[data-res]", body).map((i) => ({ name: i.dataset.res, value: i.value }));
            const file = $("#ext-file", body)?.files[0];
            if (file) data.external_report = await upload(file, name);
            const r = await call("lab.save_test", { name, data, action });
            if (action === "result") toast(t.lab_only ? `Result released${r.interpretation ? " · " + r.interpretation : ""}` : `Result sent back to the doctor${r.interpretation ? " · " + r.interpretation : ""}`);
            else if (action === "collect") toast("Sample collected");
            else if (action === "send_external") toast("Marked as sent to " + (data.external_facility || "external facility"));
            else if (action === "cancel") toast("Test cancelled");
            else toast("Saved");
            hh.close();
            await loadAll();
            if (action === "result" && t.lab_only) return releasedDialog(t, r);
            if (stay && action !== "cancel") openTest(name);
        }
    }

    function releasedDialog(t, r) {
        const allDone = r.visit_status === "Completed";
        modal({
            title: "Results released",
            sub: `${esc(t.patient_name)} · ${esc(t.test_type)}`,
            body: `<div class="liveinfo ok">${allDone ? "All tests for this patient are done." : "Some other tests for this patient are still in progress."}</div>
                <p style="margin:0;color:var(--ink-3)">Print the confidential lab report for the patient to take back${t.referring_facility ? " to <b>" + esc(t.referring_facility) + "</b>" : " to their referring doctor"}.
                ${allDone ? "" : "You can also wait and print once every test is resulted, so it is one report."}</p>`,
            foot: [{ label: "Later" }, { label: "Print report", cls: "btn--primary", onClick: (hh) => { window.open(reportUrl(t.visit), "_blank"); hh.close(); } }],
        });
    }

    // ------------------------------------------------------------ walk-in / referred requests
    function walkIn() {
        Desk.pickPatient({
            title: "Who is the request for?",
            onPick: (p) => {
                if (p.open_visit) return toast(`${p.full_name} already has an open visit (${p.open_visit.status}).`, "warn");
                openWalkIn(p);
            },
        });
    }

    function openWalkIn(p) {
        const selected = new Set();
        const cats = [...new Set(M.test_types.map((t) => t.category))];
        const h = modal({
            title: "Lab request",
            sub: "For patients who come only for tests, including those referred from other clinics",
            size: "wide",
            body: `${banner(p)}
                <div class="grid-2">
                    ${field("referring_facility", "Referred by (leave blank for a walk-in)", { placeholder: "Type to search or add a facility" })}
                    ${field("referring_clinician", "Referring clinician")}
                </div>
                ${field("referral_reason", "Reason / clinical details", { type: "textarea", rows: 2 })}
                <div class="subhead">Tests</div>
                ${cats.map((c) => `<div class="printnote" style="margin:10px 0 6px">${esc(c)}</div><div class="chipbox">
                    ${M.test_types.filter((t) => t.category === c).map((t) => `<button class="chipsel" data-t="${esc(t.name)}">${esc(t.name)}${t.performed_where === "External" ? "<small>ext</small>" : ""}</button>`).join("")}</div>`).join("")}`,
            foot: [
                { label: "Cancel" },
                { label: "Create request", cls: "btn--primary", onClick: async (hh) => {
                    if (!selected.size) return toast("Select at least one test", "warn");
                    const v = read(hh.body);
                    const r = await call("lab.create_walk_in", { patient: p.name, tests: [...selected], ...v });
                    toast(`${r.tests.length} test(s) requested`);
                    hh.close(); loadAll();
                } },
            ],
        });
        Desk.facilityField($("[data-f=referring_facility]", h.body));
        $$(".chipsel", h.body).forEach((b) => b.addEventListener("click", () => {
            const t = b.dataset.t;
            if (selected.has(t)) selected.delete(t); else selected.add(t);
            b.classList.toggle("on");
        }));
    }

    await loadAll();
    Desk.poll(loadAll);
})();
