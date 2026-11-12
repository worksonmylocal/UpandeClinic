/* Clinic Insights: reports and analytics over the clinic's own records */
(async function () {
    const { call, $, $$, esc, num, dateOf, timeOf, pill, empty, toast, kpis, chart, modal, COLORS } = Desk;

    await Desk.shell({
        page: "insights",
        eyebrow: "Northlake Medical Centre · Reports",
        title: "Clinic Insights",
        sub: "Cases, visits, sick-off, billing, laboratory and accidents at a glance",
        tools: `<button class="iconbtn" id="export" title="Export this view as a spreadsheet (CSV)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg></button>
                <button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });

    const SERIES = ["#2c6bb3", "#e07a3a", "#228883", "#b9770e", "#c4302b", "#5b4aa7"];
    const money = (v) => "KES " + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const hm = (m) => (m == null ? "—" : Desk.duration(m));
    const clock = (v) => (v ? `${esc(dateOf(v).slice(5))} ${esc(timeOf(v))}` : "—");
    const row = (cells) => `<tr>${cells.map((c, i) => `<td${typeof c === "object" && c.num ? ' class="num"' : ""}>${typeof c === "object" ? c.h : c}</td>`).join("")}</tr>`;
    const table = (title, heads, rows, emptyMsg, meta = "") =>
        `<div class="card"><div class="card__head"><h3>${esc(title)}</h3>${meta ? `<span class="meta">${meta}</span>` : ""}</div>
        ${rows.length ? `<div class="tscroll"><table class="dtable"><tr>${heads.map((h) => `<th${h.startsWith("#") ? ' class="num"' : ""}>${esc(h.replace(/^#/, ""))}</th>`).join("")}</tr>${rows.join("")}</table></div>` : empty(emptyMsg)}</div>`;
    const N = (v) => ({ num: 1, h: v });
    const chartCard = (id, title) => `<div class="card chart-wrap"><div class="card__head"><h3>${esc(title)}</h3></div><canvas id="${id}" height="240"></canvas></div>`;
    const pair = (a, b) => `<div class="row-2-eq">${a}${b || ""}</div>`;
    const lineOf = (id, labels, series) => chart(id, { type: "line", data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.values, borderColor: SERIES[i], backgroundColor: SERIES[i] + "22", pointStyle: ["circle", "rect", "triangle"][i % 3], pointRadius: 4, tension: 0.2, fill: series.length === 1 })) }, options: { plugins: { legend: { display: series.length > 1 } } } });
    const barOf = (id, labels, series, { horizontal = false, stacked = false } = {}) => chart(id, { type: "bar", data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.values, backgroundColor: s.color || SERIES[i], borderRadius: 6, maxBarThickness: 34 })) }, options: { indexAxis: horizontal ? "y" : "x", plugins: { legend: { display: series.length > 1 } }, scales: stacked ? { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } : {} } });
    const heat = (v, max) => (v ? `style="background:rgba(44,107,179,${(0.12 + 0.7 * v / Math.max(max, 1)).toFixed(2)});color:${v / Math.max(max, 1) > 0.5 ? "#fff" : "var(--ink)"};text-align:center;font-weight:600"` : 'style="text-align:center"');
    const cap = (a) => (a || []).slice(0, 8);

    // Each view: render(d) -> html, afterRender(d) -> KPI tiles, draw(d) -> charts, csv(d) -> rows
    const VIEWS = {
        overview: {
            label: "Overview",
            render(d) {
                return `<div class="live-grid" id="ov-kpis"></div>${chartCard("c-ov", "Visits, Consultations and Incidents by Month")}
                    ${table("Top Cases", ["Condition", "#Cases", "#Share"], d.top_cases.map((r) => row([esc(r.condition), N(num(r.cases)), N(r.share + "%")])), "No diagnoses recorded in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis, P = Desk.PALETTE, I = Desk.ICO;
                Desk.livelyTiles($("#ov-kpis"), [
                    { label: "Consultations", value: k.consultations, color: P[0], icon: I.stetho, unit: `${num(k.patients)} patients seen${k.medicals ? " · " + num(k.medicals) + " employment medicals" : ""}` },
                    { label: "Clinic Visits", value: k.visits, color: P[2], icon: I.users, unit: "Checked in at the front desk" },
                    { label: "Sick-Off", value: k.sick_offs, color: P[5], icon: I.cal, unit: `${num(k.sick_days)} sick days given` },
                    { label: "Lab Tests", value: k.lab_tests, color: P[4], icon: I.flask, unit: `${num(k.lab_pending)} awaiting results` },
                    { label: "Accidents & Incidents", value: k.incidents, color: P[3], icon: I.alert, unit: `${num(k.accidents)} accidents` },
                    { label: "Referred Out", value: k.referred, color: P[1], icon: I.out, unit: `${num(k.work_related)} work-related cases` },
                ]);
            },
            draw(d) {
                const m = d.by_month;
                lineOf("c-ov", m.labels, [{ label: "Visits", values: m.visits }, { label: "Consultations", values: m.consultations }, { label: "Accidents & incidents", values: m.incidents }]);
            },
            csv: (d) => [["Figure", "Value"], ...Object.entries(d.kpis).map(([k, v]) => [k.replace(/_/g, " "), v]), [], ["Condition", "Cases", "Share %"], ...d.top_cases.map((r) => [r.condition, r.cases, r.share])],
        },

        health: {
            label: "Disease & Health",
            render(d) {
                const max = Math.max(1, ...d.rows.flatMap((r) => r.cells));
                const body = d.rows.map((r) => `<tr><td><b>${esc(r.condition)}</b></td>
                    ${r.cells.map((c) => `<td ${heat(c, max)}>${c || ""}</td>`).join("")}<td class="num"><b>${r.total}</b></td><td class="num">${r.percent}%</td><td class="num">${r.average}</td></tr>`);
                if (d.rows.length) body.push(`<tr class="total-row"><td><b>TOTAL</b></td>${d.col_totals.map((c) => `<td style="text-align:center"><b>${c}</b></td>`).join("")}<td class="num"><b>${d.grand_total}</b></td><td class="num">100%</td><td class="num">${d.monthly_average}</td></tr>`);
                return `<div class="kpi-grid" id="h-kpis"></div>${pair(chartCard("c-top", "Top Conditions by Encounters"), chartCard("c-trend", "Monthly Consultations by Year"))}
                    <div class="card"><div class="card__head"><h3>Conditions by Month</h3></div>
                    ${d.rows.length ? `<div class="tscroll"><table class="dtable"><tr><th>Condition</th>${d.labels.map((l) => `<th style="text-align:center">${esc(l)}</th>`).join("")}<th class="num">Total</th><th class="num">Share</th><th class="num">Avg</th></tr>${body.join("")}</table></div>` : empty("No diagnoses recorded in this period.")}</div>`;
            },
            afterRender(d) {
                kpis($("#h-kpis"), [
                    { label: "Total Encounters", value: num(d.grand_total), cls: "good" }, { label: "Conditions Tracked", value: num(d.conditions) },
                    { label: "Monthly Average", value: num(d.monthly_average) }, { label: "Months Reported", value: num(d.months_reported) },
                ]);
            },
            draw(d) {
                const top = cap(d.rows);
                barOf("c-top", top.map((r) => r.condition), [{ label: "Encounters", values: top.map((r) => r.total) }], { horizontal: true });
                lineOf("c-trend", d.trend.labels, d.trend.years.map((y) => ({ label: String(y.year), values: y.values })));
            },
            csv: (d) => [["Condition", ...d.labels, "Total", "%", "Avg"], ...d.rows.map((r) => [r.condition, ...r.cells, r.total, r.percent, r.average]), ["TOTAL", ...d.col_totals, d.grand_total, 100, d.monthly_average]],
        },

        visits: {
            label: "Clinic Visits",
            render(d) {
                return `<div class="live-grid" id="v-kpis"></div>${pair(chartCard("c-vm", "Visits by Month"), chartCard("c-vh", "Arrivals by Hour"))}
                    ${pair(chartCard("c-vd", "Visits by Day of the Week"), `<div class="card"><div class="card__head"><h3>How Patients Arrived</h3></div><div id="v-src"></div><div class="card__head" style="margin-top:18px"><h3>Where They Were Sent</h3></div><div id="v-svc"></div></div>`)}`;
            },
            afterRender(d) {
                const k = d.kpis, P = Desk.PALETTE, I = Desk.ICO;
                Desk.livelyTiles($("#v-kpis"), [
                    { label: "Visits", value: k.visits, color: P[0], icon: I.users, unit: `${k.avg_per_day} a day` },
                    { label: "Employees", value: k.employees, color: P[2], icon: I.users, unit: `${num(k.community)} community members` },
                    { label: "Avg Door-to-Triage", value: k.avg_wait, color: P[3], icon: I.clock, unit: "minutes from check-in to vitals" },
                    { label: "Referred In", value: k.referred_in, color: P[1], icon: I.out, unit: "From other facilities" },
                ]);
                Desk.ranked($("#v-src"), d.by_source);
                Desk.ranked($("#v-svc"), d.by_service);
            },
            draw(d) {
                lineOf("c-vm", d.by_month.labels, [{ label: "Visits", values: d.by_month.visits }]);
                barOf("c-vh", d.by_hour.labels, [{ label: "Arrivals", values: d.by_hour.values }]);
                barOf("c-vd", d.by_weekday.labels, [{ label: "Visits", values: d.by_weekday.values }]);
            },
            csv: (d) => [["Visits by month"], ...d.by_month.labels.map((l, i) => [l, d.by_month.visits[i]]), [], ["Source", "Visits"], ...d.by_source.map((r) => [r.label, r.value])],
        },

        sickoff: {
            label: "Sick-Off",
            render(d) {
                return `<div class="kpi-grid" id="s-kpis"></div>${pair(chartCard("c-sm", "Sick-Off Records and Days by Month"), chartCard("c-sd", "Sick-Off Length"))}
                    ${table("Most Sick Days", ["Employee", "Department", "#Episodes", "#Sick days"], d.top_employees.map((r) => row([`<b>${esc(r.employee_name)}</b> <span class="printnote">${esc(r.staff_no || "")}</span>`, esc(r.department || "—"), N(r.episodes), N(`<b>${r.days}</b>`)])), "Nobody was signed off in this period.")}
                    ${table("Referred to Other Facilities", ["Facility", "#Visits", "#Employees", "#Sick-off days given"], d.facilities.map((r) => row([esc(r.facility), N(r.visits), N(r.employees), N(r.sick_days)])), "Nobody was referred out in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#s-kpis"), [
                    { label: "Sick-Off Records", value: num(k.records), cls: k.records ? "warn" : "" }, { label: "Employees", value: num(k.employees) },
                    { label: "Sick Days", value: num(k.days) }, { label: "Avg Days / Episode", value: num(k.avg_days) },
                    { label: "Light Duty", value: num(k.light_duty), unit: `${num(k.light_duty_days)} days` }, { label: "Referred Out", value: num(k.referred_out) },
                ]);
            },
            draw(d) {
                barOf("c-sm", d.by_month.labels, [{ label: "Records", values: d.by_month.records }, { label: "Sick days", values: d.by_month.days }]);
                barOf("c-sd", d.durations.labels, [{ label: "Records", values: d.durations.values }]);
            },
            csv: (d) => [["Employee", "Staff no.", "Department", "Episodes", "Sick days"], ...d.top_employees.map((r) => [r.employee_name, r.staff_no || "", r.department || "", r.episodes, r.days])],
        },

        cost: {
            label: "Billing & Cost",
            render(d) {
                return `<div class="kpi-grid" id="c-kpis"></div>${pair(chartCard("c-cm", "Billed by Month (KES)"), chartCard("c-cg", "Where the Money Comes From"))}
                    ${table("Farm Invoices", ["Farm", "#Encounters", "#Billed", "#Paid"], d.farms.map((r) => row([`<b>${esc(r.farm)}</b>`, N(r.bills), N(money(r.total)), N(money(r.paid))])), "No farm invoices in this period.")}
                    ${table("Most Dispensed Drugs", ["Drug", "#Quantity", "#Dispensings"], d.top_drugs.map((r) => row([`<b>${esc(r.drug)}</b>`, N(num(r.qty)), N(num(r.dispensings))])), "Nothing has been dispensed in this period.")}
                    ${table("Highest Billed Patients", ["Patient", "Department", "#Visits", "#Billed"], d.top_patients.map((r) => row([`<b>${esc(r.employee_name)}</b>`, esc(r.department || "—"), N(r.visits), N(money(r.cost))])), "Nothing was billed in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#c-kpis"), [
                    { label: "Bills", value: num(k.bills), cls: "good" }, { label: "Total Billed", value: money(k.total) },
                    { label: "Avg per Visit", value: money(k.avg) }, { label: "Paid", value: money(k.paid), cls: "good" },
                    { label: "Invoiced to Farms", value: money(k.invoiced), cls: "info" }, { label: "Outstanding", value: money(k.outstanding), cls: k.outstanding ? "warn" : "" },
                ]);
            },
            draw(d) {
                barOf("c-cm", d.by_month.labels, [{ label: "Billed", values: d.by_month.total }]);
                chart("c-cg", { type: "doughnut", data: { labels: d.by_type.map((r) => r.label), datasets: [{ data: d.by_type.map((r) => r.value), backgroundColor: SERIES, borderWidth: 0 }] }, options: { plugins: { legend: { position: "right" } }, cutout: "62%" } });
            },
            csv: (d) => [["Farm", "Encounters", "Billed", "Paid"], ...d.farms.map((r) => [r.farm, r.bills, r.total, r.paid]), [], ["Patient", "Department", "Visits", "Billed"], ...d.top_patients.map((r) => [r.employee_name, r.department || "", r.visits, r.cost])],
        },

        lab: {
            label: "Laboratory",
            render(d) {
                return `<div class="kpi-grid" id="l-kpis"></div>${pair(chartCard("c-lm", "Requests by Month"), chartCard("c-lo", "Result Outcomes"))}
                    ${table("Requests by Test", ["Test", "#Requested", "#Positive / abnormal", "#Negative / normal"], d.by_type.map((r) => row([`<b>${esc(r.test)}</b>`, N(r.total), N(r.positive || ""), N(r.negative || "")])), "No tests requested in this period.")}
                    ${table("Positive and Abnormal Results", ["Date", "Patient", "Test", "Outcome"], d.flagged.map((r) => row([esc(dateOf(r.at)), esc(r.patient_name), esc(r.test), pill(r.flag, "bad")])), "No positive or abnormal results in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#l-kpis"), [
                    { label: "Requested", value: num(k.requested), cls: "good", unit: `${num(k.urgent)} urgent` }, { label: "Resulted", value: num(k.resulted) },
                    { label: "Awaiting Results", value: num(k.pending), cls: k.pending ? "warn" : "" }, { label: "Sent to External Lab", value: num(k.external) },
                    { label: "Positive / Abnormal", value: num(k.positive), cls: k.positive ? "bad" : "" }, { label: "Avg Turnaround", value: d.avg_turnaround == null ? "—" : hm(d.avg_turnaround), unit: "Request to result" },
                ]);
            },
            draw(d) {
                lineOf("c-lm", d.by_month.labels, [{ label: "Requests", values: d.by_month.requests }]);
                barOf("c-lo", d.outcomes.map((f) => f.label), [{ label: "Results", values: d.outcomes.map((f) => f.value), color: COLORS.emp }]);
            },
            csv: (d) => [["Test", "Requested", "Positive/abnormal", "Negative/normal"], ...d.by_type.map((r) => [r.test, r.total, r.positive, r.negative])],
        },

        accidents: {
            label: "Accidents",
            render(d) {
                return `<div class="kpi-grid" id="a-kpis"></div>${pair(chartCard("c-am", "Accidents and Incidents by Month"), chartCard("c-as", "By Severity"))}
                    ${pair(chartCard("c-ac", "By Cause"), chartCard("c-ad", "By Department"))}
                    ${table("Records", ["Date", "Type", "Patient", "Department", "What", "Outcome", "Status"], d.records.map((r) => row([esc(r.at), pill(r.report_type, r.report_type === "Accident" ? "bad" : "warn"), esc(r.patient_name || "—"), esc(r.department || r.employer || "—"), esc(r.description || "—"), esc(r.outcome || "—"), pill(r.status, r.status === "Closed" ? "good" : "warn")])), "No accidents or incidents in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#a-kpis"), [
                    { label: "Records", value: num(k.records), cls: "good" }, { label: "Accidents", value: num(k.accidents), cls: k.accidents ? "bad" : "" },
                    { label: "Severe or Fatal", value: num(k.serious), cls: k.serious ? "bad" : "" }, { label: "Work-Related", value: num(k.work_related) },
                    { label: "Days Lost", value: num(k.lost_days) }, { label: "Sent to Hospital", value: num(k.hospital), cls: k.hospital ? "warn" : "" },
                ]);
            },
            draw(d) {
                barOf("c-am", d.by_month.labels, [{ label: "Accidents & incidents", values: d.by_month.incidents, color: COLORS.bad }]);
                barOf("c-as", d.by_severity.map((r) => r.label), [{ label: "Records", values: d.by_severity.map((r) => r.value), color: COLORS.warn }]);
                barOf("c-ac", d.by_cause.map((r) => r.label), [{ label: "Cases", values: d.by_cause.map((r) => r.value) }], { horizontal: true });
                barOf("c-ad", d.by_department.map((r) => r.label), [{ label: "Cases", values: d.by_department.map((r) => r.value) }], { horizontal: true });
            },
            csv: (d) => [["Date", "Type", "Severity", "Patient", "Department", "What", "Outcome", "Status"], ...d.records.map((r) => [r.at, r.report_type, r.severity, r.patient_name || "", r.department || "", r.description || "", r.outcome || "", r.status])],
        },
    };

    // ---------------------------------------------------------------- filters, tabs, loading
    let current = "overview", last = null, seq = 0;
    try { current = localStorage.getItem("clinic.insights.view") || "overview"; } catch (e) { /* storage may be blocked */ }
    if (!VIEWS[current]) current = "overview";

    $("#views").innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button class="tab${k === current ? " on" : ""}" data-view="${k}">${esc(v.label)}</button>`).join("");
    $("#f-month").innerHTML += ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    const thisYear = new Date().getFullYear();
    $("#f-year").innerHTML = `<option value="${thisYear}">${thisYear}</option>`;

    const filters = () => ({
        year: $("#f-year").value, month: $("#f-month").value, from_date: $("#f-from").value, to_date: $("#f-to").value, department: $("#f-dept").value,
    });

    async function load() {
        const mine = ++seq;
        $("#view").innerHTML = '<div class="skel"></div>';
        let res;
        try { res = await call("insights.dashboard", { view: current, ...filters() }); } catch (e) { $("#view").innerHTML = `<div class="card">${empty(e.message || "Could not load this view.")}</div>`; return; }
        if (mine !== seq) return; // a newer request replaced this one
        // Fill the pickers once, from what the clinic actually has
        const f = filters();
        $("#f-year").innerHTML = res.meta.years.map((y) => `<option value="${y}">${y}</option>`).join("");
        $("#f-year").value = f.year || String(res.meta.years[0]);
        if ($("#f-dept").options.length === 1) {
            $("#f-dept").innerHTML += res.meta.departments.map((x) => `<option>${esc(x)}</option>`).join("");
            $("#f-dept").value = f.department;
        }
        last = res.data;
        const v = VIEWS[current];
        $("#view").innerHTML = v.render(res.data);
        if (v.afterRender) v.afterRender(res.data);
        if (v.draw) v.draw(res.data);
    }

    $$("#views .tab").forEach((b) => b.addEventListener("click", () => {
        $$("#views .tab").forEach((x) => x.classList.toggle("on", x === b));
        current = b.dataset.view;
        try { localStorage.setItem("clinic.insights.view", current); } catch (e) { /* ignore */ }
        load();
    }));
    ["#f-year", "#f-month", "#f-dept"].forEach((s) => $(s).addEventListener("change", () => { if (s !== "#f-dept") { $("#f-from").value = $("#f-to").value = ""; } load(); }));
    ["#f-from", "#f-to"].forEach((s) => $(s).addEventListener("change", load));
    $("#f-clear").addEventListener("click", () => { $("#f-from").value = $("#f-to").value = ""; load(); });
    $("#refresh").addEventListener("click", () => { load(); toast("Refreshed"); });
    $("#export").addEventListener("click", () => {
        if (!last) return;
        const csv = VIEWS[current].csv(last).map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
        a.download = `clinic-insights-${current}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    await load();
})();
