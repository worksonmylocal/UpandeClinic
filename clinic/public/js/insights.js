/* Clinic Insights: reports and analytics over the clinic's own records */
(async function () {
    const { call, $, $$, esc, num, dateOf, timeOf, pill, empty, toast, kpis, chart, modal, COLORS } = Desk;

    await Desk.shell({
        page: "insights",
        eyebrow: "Mutara Clinic · Reports",
        title: "Clinic Insights",
        sub: "Cases, visits, sick-off, drug cost, investigations and accidents at a glance",
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

    // Each view: render(d) -> html, draw(d) -> charts, csv(d) -> rows, drill -> a function that opens the people behind a row
    const VIEWS = {
        overview: {
            label: "Overview",
            render(d) {
                return `<div class="kpi-grid" id="ov-kpis"></div>${chartCard("c-ov", "Consultations, Visits and Incidents by Month")}
                    ${table("Top Cases", ["Condition", "#Cases", "#Share"], d.top_cases.map((r) => row([esc(r.condition), N(num(r.cases)), N(r.share + "%")])), "No diagnoses recorded in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#ov-kpis"), [
                    { label: "Consultations", value: num(k.consultations), cls: "good", unit: `${num(k.patients)} employees seen` },
                    { label: "Clinic Visits", value: k.clinic_visits == null ? "—" : num(k.clinic_visits), unit: "From the clinic biometric" },
                    { label: "Sick-Off", value: num(k.sick_offs), cls: k.sick_offs ? "warn" : "", unit: `${num(k.sick_days)} sick days given` },
                    { label: "Investigations", value: num(k.investigations), unit: `${num(k.awaiting_results)} awaiting results` },
                    { label: "Accidents & Incidents", value: num(k.incidents), cls: k.accidents ? "bad" : "", unit: `${num(k.accidents)} accidents` },
                    { label: "First Aid in the Field", value: num(k.first_aid), unit: "Cases attended by first aiders" },
                ]);
            },
            draw(d) {
                const m = d.by_month, series = [{ label: "Consultations", values: m.consultations }];
                if (m.visits) series.push({ label: "Clinic visits", values: m.visits });
                series.push({ label: "Incidents & first aid", values: m.incidents });
                lineOf("c-ov", m.labels, series);
            },
            csv: (d) => [["Figure", "Value"], ...Object.entries(d.kpis).map(([k, v]) => [k.replace(/_/g, " "), v]), [], ["Condition", "Cases", "Share %"], ...d.top_cases.map((r) => [r.condition, r.cases, r.share])],
        },

        health: {
            label: "Disease & Health",
            drill: "condition",
            render(d) {
                const max = Math.max(1, ...d.rows.flatMap((r) => r.cells));
                const body = d.rows.map((r) => `<tr class="drill" data-value="${esc(r.condition)}" tabindex="0"><td><b>${esc(r.condition)}</b></td>
                    ${r.cells.map((c) => `<td ${heat(c, max)}>${c || ""}</td>`).join("")}<td class="num"><b>${r.total}</b></td><td class="num">${r.percent}%</td><td class="num">${r.average}</td></tr>`);
                if (d.rows.length) body.push(`<tr class="total-row"><td><b>TOTAL</b></td>${d.col_totals.map((c) => `<td style="text-align:center"><b>${c}</b></td>`).join("")}<td class="num"><b>${d.grand_total}</b></td><td class="num">100%</td><td class="num">${d.monthly_average}</td></tr>`);
                return `<div class="kpi-grid" id="h-kpis"></div>${pair(chartCard("c-top", "Top Conditions by Encounters"), chartCard("c-trend", "Monthly Encounters by Year"))}
                    <div class="card"><div class="card__head"><h3>Conditions by Month</h3><span class="meta">Click a condition to see who was seen</span></div>
                    ${d.rows.length ? `<div class="tscroll"><table class="dtable"><tr><th>Condition</th>${d.labels.map((l) => `<th style="text-align:center">${esc(l)}</th>`).join("")}<th class="num">Total</th><th class="num">Share</th><th class="num">Avg</th></tr>${body.join("")}</table></div>` : empty("No diagnoses recorded in this period.")}</div>`;
            },
            afterRender(d) {
                kpis($("#h-kpis"), [
                    { label: "Total Encounters", value: num(d.grand_total), cls: "good" },
                    { label: "Conditions Tracked", value: num(d.conditions) },
                    { label: "Monthly Average", value: num(d.monthly_average) },
                    { label: "Months Reported", value: num(d.months_reported) },
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
                if (!d.configured) return `<div class="card">${empty(d.reason)}</div>`;
                return `<div class="kpi-grid" id="v-kpis"></div>${pair(chartCard("c-vm", "Clinic Visits by Month"), chartCard("c-vh", "Arrivals & Departures by Hour"))}
                    ${table("Most Frequent Visitors", ["Employee", "Department", "#Visits", "First in", "Last out", "#Time in clinic"],
                        d.top_employees.map((r) => row([`<b>${esc(r.employee_name)}</b> <span class="printnote">${esc(r.employee)}</span>`, esc(r.department || "—"), N(r.visits), clock(r.first_in), clock(r.last_out), N(hm(r.minutes))])), "No clinic visits in this period.")}`;
            },
            afterRender(d) {
                if (!d.configured) return;
                const k = d.kpis;
                kpis($("#v-kpis"), [
                    { label: "Clinic Visits", value: num(k.visits), cls: "good", unit: `${num(k.punches)} touches on the device` },
                    { label: "Employees", value: num(k.employees) },
                    { label: "Days with Visits", value: num(k.days), unit: `${k.avg_per_day} visits a day` },
                    { label: "Avg Time in Clinic", value: hm(k.avg_minutes), unit: `${hm(k.total_minutes)} in total` },
                    { label: "Missing Check-out", value: num(k.no_checkout), cls: k.no_checkout ? "warn" : "" },
                ]);
            },
            draw(d) {
                if (!d.configured) return;
                lineOf("c-vm", d.by_month.labels, [{ label: "Visits", values: d.by_month.visits }]);
                barOf("c-vh", d.by_hour.labels, [{ label: "Checked in", values: d.by_hour.in }, { label: "Checked out", values: d.by_hour.out }]);
            },
            csv: (d) => (d.configured ? [["Employee", "Department", "Visits", "First in", "Last out", "Minutes in clinic"], ...d.top_employees.map((r) => [r.employee_name, r.department || "", r.visits, r.first_in || "", r.last_out || "", r.minutes])] : [[d.reason]]),
        },

        sickoff: {
            label: "Sick-Off",
            drill: "sick_employee",
            render(d) {
                return `<div class="kpi-grid" id="s-kpis"></div>${pair(chartCard("c-sm", "Sick-Off Records and Days by Month"), chartCard("c-sd", "Sick-Off Length"))}
                    ${table("Most Sick Days", ["Employee", "Department", "#Episodes", "#Sick days"], d.top_employees.map((r) => `<tr class="drill" data-value="${esc(r.patient)}" tabindex="0"><td><b>${esc(r.employee_name)}</b> <span class="printnote">${esc(r.staff_no || "")}</span></td><td>${esc(r.department || "—")}</td><td class="num">${r.episodes}</td><td class="num"><b>${r.days}</b></td></tr>`), "No sick-off given in this period.", "Click a row for the details")}
                    ${table("Referred to Other Facilities", ["Facility", "#Visits", "#Employees", "#Sick-off days given"], d.facilities.map((r) => row([esc(r.facility), N(r.visits), N(r.employees), N(r.sick_days)])), "Nobody was referred out in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#s-kpis"), [
                    { label: "Sick-Off Records", value: num(k.records), cls: k.records ? "warn" : "" },
                    { label: "Employees", value: num(k.employees) },
                    { label: "Sick Days", value: num(k.days) },
                    { label: "Avg Days / Episode", value: num(k.avg_days) },
                    { label: "Light Duty", value: num(k.light_duty), unit: `${num(k.light_duty_days)} days` },
                    { label: "Referred Out", value: num(k.referred_out) },
                ]);
            },
            draw(d) {
                barOf("c-sm", d.by_month.labels, [{ label: "Records", values: d.by_month.records }, { label: "Sick days", values: d.by_month.days }]);
                barOf("c-sd", d.durations.labels, [{ label: "Records", values: d.durations.values }]);
            },
            csv: (d) => [["Employee", "Staff no.", "Department", "Episodes", "Sick days"], ...d.top_employees.map((r) => [r.employee_name, r.staff_no || "", r.department || "", r.episodes, r.days])],
        },

        cost: {
            label: "Visits & Cost",
            drill: "cost_employee",
            render(d) {
                return `<div class="kpi-grid" id="c-kpis"></div>${d.kpis.unpriced ? `<div class="card" style="padding:14px 20px;color:var(--warn);background:var(--warn-bg)">${d.kpis.unpriced} drug${d.kpis.unpriced === 1 ? " has" : "s have"} no price in the store yet, so ${d.kpis.unpriced === 1 ? "its" : "their"} cost counts as zero.</div>` : ""}
                    ${pair(chartCard("c-cm", "Drug Cost by Month"), chartCard("c-cg", "Spend by Drug Group"))}
                    ${table("Spend by Drug Group", ["Group", "#Items", "#Cost", "#Share"], d.by_group.map((r) => row([esc(r.group), N(num(r.items)), N(money(r.cost)), N(r.percent + "%")])), "Nothing has been dispensed in this period.")}
                    ${table("Most Dispensed Drugs", ["Drug", "#Quantity", "#Cost"], d.top_drugs.map((r) => `<tr class="drill" data-kind="drug" data-value="${esc(r.drug)}" tabindex="0"><td><b>${esc(r.drug)}</b></td><td class="num">${num(r.qty)}</td><td class="num">${money(r.cost)}</td></tr>`), "Nothing has been dispensed in this period.", "Click a row for the details")}
                    ${table("Costliest Employees", ["Employee", "Department", "#Visits", "#Cost", "Last visit"], d.top_employees.map((r) => `<tr class="drill" data-value="${esc(r.patient)}" tabindex="0"><td><b>${esc(r.employee_name)}</b> <span class="printnote">${esc(r.staff_no || "")}</span></td><td>${esc(r.department || "—")}</td><td class="num">${r.visits}</td><td class="num">${money(r.cost)}</td><td>${esc(dateOf(r.last))}</td></tr>`), "No dispensing in this period.", "Click a row for the details")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#c-kpis"), [
                    { label: "Dispensings", value: num(k.visits), cls: "good" },
                    { label: "Employees Served", value: num(k.employees) },
                    { label: "Total Drug Cost", value: money(k.cost) },
                    { label: "Avg Cost / Visit", value: money(k.avg_cost) },
                    { label: "Cost / Employee", value: money(k.cost_per_employee) },
                ]);
            },
            draw(d) {
                barOf("c-cm", d.by_month.labels, [{ label: "Cost", values: d.by_month.cost }]);
                const g = cap(d.by_group), byCost = g.some((r) => r.cost > 0); // unpriced drugs: show the item count instead
                chart("c-cg", { type: "doughnut", data: { labels: g.map((r) => r.group), datasets: [{ data: g.map((r) => (byCost ? r.cost : r.items)), backgroundColor: SERIES, borderWidth: 0 }] }, options: { plugins: { legend: { position: "right" } }, cutout: "62%" } });
            },
            csv: (d) => [["Drug group", "Items", "Cost", "Share %"], ...d.by_group.map((r) => [r.group, r.items, r.cost, r.percent]), [], ["Employee", "Staff no.", "Department", "Visits", "Cost"], ...d.top_employees.map((r) => [r.employee_name, r.staff_no || "", r.department || "", r.visits, r.cost])],
        },

        investigations: {
            label: "Investigations",
            render(d) {
                const st = d.statuses;
                return `<div class="kpi-grid" id="i-kpis"></div>${pair(chartCard("c-im", "Requests by Month"), chartCard("c-if", "Result Outcomes"))}
                    ${table("Requests by Investigation", ["Investigation", ...st.map((x) => "#" + x), "#Total"], d.by_type.map((r) => row([`<b>${esc(r.investigation)}</b>`, ...st.map((x) => N(r[x] || "")), N(`<b>${r.total}</b>`)])), "No investigations requested in this period.")}
                    ${table("Abnormal and Critical Results", ["Date", "Employee", "Investigation", "Outcome", "Impression"], d.flagged.map((r) => row([esc(dateOf(r.at)), esc(r.patient_name), esc(r.investigation), pill(r.flag, r.flag === "Critical" ? "bad" : "warn"), esc(r.impression || "—")])), "No abnormal results in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#i-kpis"), [
                    { label: "Requested", value: num(k.requested), cls: "good", unit: `${num(k.urgent)} urgent` },
                    { label: "Awaiting Results", value: num(k.awaiting), cls: k.awaiting ? "warn" : "" },
                    { label: "Results Received", value: num(k.received) },
                    { label: "Reviewed", value: num(k.reviewed) },
                    { label: "Abnormal", value: num(k.abnormal), cls: k.abnormal ? "warn" : "" },
                    { label: "Critical", value: num(k.critical), cls: k.critical ? "bad" : "" },
                ]);
            },
            draw(d) {
                lineOf("c-im", d.by_month.labels, [{ label: "Requests", values: d.by_month.requests }]);
                barOf("c-if", d.flags.map((f) => f.label), [{ label: "Results", values: d.flags.map((f) => f.value), color: COLORS.emp }]);
            },
            csv: (d) => [["Investigation", ...d.statuses, "Total"], ...d.by_type.map((r) => [r.investigation, ...d.statuses.map((s) => r[s] || 0), r.total])],
        },

        accidents: {
            label: "Accidents",
            render(d) {
                return `<div class="kpi-grid" id="a-kpis"></div>${pair(chartCard("c-am", "Accidents, Incidents and First Aid by Month"), chartCard("c-an", "First Aid by Nature of Injury"))}
                    ${pair(chartCard("c-as", "Incidents by Severity"), chartCard("c-ad", "Cases by Department"))}
                    ${table("Records", ["Date", "Type", "Employee", "Department", "What", "Result", "Attended by"], d.records.map((r) => row([esc(r.at), pill(r.source, r.source === "Accident" ? "bad" : r.source === "First aid" ? "info" : "warn"), esc(r.employee_name || "—"), esc(r.department || "—"), esc(r.what || "—"), esc(r.result || "—"), esc(r.attended_by || "—")])), "No accidents, incidents or first aid cases in this period.")}`;
            },
            afterRender(d) {
                const k = d.kpis;
                kpis($("#a-kpis"), [
                    { label: "Records", value: num(k.records), cls: "good" },
                    { label: "Accidents", value: num(k.accidents), cls: k.accidents ? "bad" : "" },
                    { label: "Severe or Fatal", value: num(k.serious), cls: k.serious ? "bad" : "" },
                    { label: "Work-Related", value: num(k.work_related) },
                    { label: "First Aid Cases", value: num(k.first_aid) },
                    { label: "Sent to Hospital", value: num(k.hospital), cls: k.hospital ? "warn" : "" },
                ]);
            },
            draw(d) {
                barOf("c-am", d.by_month.labels, [{ label: "Incidents & accidents", values: d.by_month.incidents }, { label: "First aid", values: d.by_month.first_aid }]);
                barOf("c-an", d.by_nature.map((r) => r.label), [{ label: "Cases", values: d.by_nature.map((r) => r.value) }], { horizontal: true });
                barOf("c-as", d.by_severity.map((r) => r.label), [{ label: "Incidents", values: d.by_severity.map((r) => r.value), color: COLORS.warn }]);
                barOf("c-ad", d.by_department.map((r) => r.label), [{ label: "Cases", values: d.by_department.map((r) => r.value) }], { horizontal: true });
            },
            csv: (d) => [["Date", "Type", "Employee", "Department", "What", "Result", "Attended by"], ...d.records.map((r) => [r.at, r.source, r.employee_name || "", r.department || "", r.what || "", r.result || "", r.attended_by || ""])],
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
        $$("#view .drill").forEach((tr) => {
            const open = () => drill(tr.dataset.kind || v.drill, tr.dataset.value, tr.cells[0].innerText.trim());
            tr.addEventListener("click", open);
            tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
        });
    }

    async function drill(kind, value, title) {
        const m = modal({ title, sub: "Who this figure is made up of", body: '<div class="skel"></div>', size: "lg" });
        try {
            const rows = await call("insights.detail", { kind, value, ...filters() });
            m.body.innerHTML = rows.length
                ? `<div class="tscroll"><table class="dtable"><tr><th>Date</th><th>Employee</th><th>Staff no.</th><th>Department</th><th>Detail</th></tr>${rows.map((r) => row([esc(dateOf(r.at)), `<b>${esc(r.patient_name)}</b>`, esc(r.staff_no || "—"), esc(r.department || "—"), esc(r.note || "—")])).join("")}</table></div>`
                : empty("Nothing to show.");
        } catch (e) { m.body.innerHTML = empty(e.message || "Could not load."); }
        m.setFoot([{ label: "Close", cls: "btn--ghost" }]);
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
