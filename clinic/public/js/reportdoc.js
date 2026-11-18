/* Printable clinic reports: stock balance, monthly stock movement, cost analysis and the Insights views.
   Same letterhead, title bar and footer as the medical documents. Also downloadable as CSV. */
(async function () {
    const { call, esc } = Desk;
    const q = new URLSearchParams(location.search);
    const which = q.get("report") || "";
    const msg = document.getElementById("msg"), btn = document.getElementById("print"), csvBtn = document.getElementById("csv");
    const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const qty = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthName = (ym) => { const [y, m] = String(ym).split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };

    const csv = []; // every table, for the CSV download
    let n = 0;
    // columns: ["Name", "Name", ...]; a leading # right-aligns a numeric column. rows: arrays; a row starting with "=" is a total row.
    function table(title, cols, rows, empty = "Nothing to report for this period.") {
        const heads = cols.map((c) => ({ h: c.replace(/^#/, ""), r: c.startsWith("#") }));
        csv.push([title], heads.map((h) => h.h), ...rows.map((r) => r.filter((_, i) => !(r[0] === "=" && i === 0)).map((x) => x ?? "")), []);
        const body = rows.length
            ? `<table class="tbl"><thead><tr>${heads.map((h) => `<th${h.r ? ' class="r"' : ""}>${esc(h.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => {
                const total = r[0] === "=", cells = total ? r.slice(1) : r;
                return `<tr${total ? ' class="tot"' : ""}>${cells.map((c, i) => `<td${heads[i] && heads[i].r ? ' class="r"' : ""}>${esc(c ?? "")}</td>`).join("")}</tr>`;
            }).join("")}</tbody></table>`
            : `<div class="note">${esc(empty)}</div>`;
        return `<section class="sec"><h2>${++n} · ${esc(title)}</h2><div class="body">${body}</div></section>`;
    }
    const figures = (items) => `<div style="display:grid;grid-template-columns:repeat(${Math.min(items.length, 5)},1fr);gap:8px;margin:0 0 12px">${items.map(([l, v, sub]) => `<div style="border:1px solid var(--hair);border-radius:6px;padding:8px 10px;background:#faf8f2"><small style="display:block;font:600 8px var(--sans);letter-spacing:1px;text-transform:uppercase;color:var(--ink-mute)">${esc(l)}</small><b style="font:700 15px var(--sans)">${esc(v)}</b>${sub ? `<div class="note" style="margin:0">${esc(sub)}</div>` : ""}</div>`).join("")}</div>`;
    const kpiTable = (title, obj) => table(title, ["Figure", "#Value"], Object.entries(obj).map(([k, v]) => [k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), v]));

    // ------------------------------------------------------------ the reports
    const REPORTS = {
        stock_balance(d) {
            const k = d.kpis;
            const rows = d.rows.map((r) => [r.item_name, r.group || "", r.uom || "", qty(r.qty), r.rate ? money(r.rate) : "—", money(r.value)]);
            if (rows.length) rows.push(["=", "TOTAL", "", "", "", "", money(k.value)]);
            return {
                title: "Stock Balance",
                right: `${d.live ? "Right now" : "As at"}<br><b>${esc(Print.dt(d.as_of))}</b>`,
                label: "Stock balance",
                file: `stock-balance-${d.as_of.slice(0, 10)}`,
                html: figures([["Items held", k.items], ["In stock", k.in_stock], ["Running low", k.low, "10 or fewer"], ["Out of stock", k.out_of_stock], ["Stock value", "KES " + money(k.value)]])
                    + table(`Stock on the shelf · ${d.warehouse}`, ["Item", "Group", "Unit", "#In stock", "#Unit cost", "#Value (KES)"], rows, "Nothing is held in the pharmacy."),
            };
        },
        stock_movement(d) {
            const k = d.kpis;
            const rows = d.rows.map((r) => [r.item_name, r.uom || "", qty(r.opening), qty(r.received), qty(r.dispensed), qty(r.other), qty(r.adjustment), qty(r.closing), money(r.closing_value)]);
            if (rows.length) rows.push(["=", "TOTAL", "", "", "", "", "", "", "", money(k.closing_value)]);
            return {
                title: "Monthly Stock Report",
                right: `<b>${esc(monthName(d.month))}</b>`,
                label: "Monthly stock",
                file: `monthly-stock-${d.month}`,
                html: figures([["Items received", k.items_received], ["Received", "KES " + money(k.received_value)], ["Dispensed", "KES " + money(k.dispensed_value)], ["Closing stock", "KES " + money(k.closing_value)]])
                    + table("Items received this month", ["Date", "Document", "From", "Item", "Unit", "#Qty", "#Unit cost", "#Value (KES)"],
                        d.receipts.map((r) => [Print.day(r.date), r.voucher, r.source, r.item, r.uom, qty(r.qty), money(r.rate), money(r.value)]), "Nothing was received this month.")
                    + table("Stock movement by item", ["Item", "Unit", "#Opening", "#Received", "#Dispensed", "#Other out", "#Adjust.", "#Closing", "#Value (KES)"], rows, "No stock activity this month.")
                    + `<div class="note">Dispensed = handed out to patients. Other out = transfers to first aid kits and other issues. Adjust. = stock counts and corrections (closing − opening − received + out). Opening ${esc(Print.day(d.from))}, closing ${esc(Print.day(d.to))}.</div>`,
            };
        },
        cost_analysis(d) {
            const k = d.kpis;
            const pct = (v) => (v ? v + "%" : "0%");
            return {
                title: "Cost Analysis",
                right: `<b>${esc(Print.day(d.from))} – ${esc(Print.day(d.to))}</b>`,
                label: "Cost analysis",
                file: `cost-analysis-${d.from}-to-${d.to}`,
                html: figures([["Drugs dispensed", "KES " + money(k.dispensed_cost), `${k.dispensings} dispensings`], ["Per dispensing", "KES " + money(k.avg_per_dispensing)], ["Per employee", "KES " + money(k.cost_per_employee), `${k.employees} employees`], ["Purchased", "KES " + money(k.purchases)], ["Stock held", "KES " + money(k.closing_value), `was KES ${money(k.opening_value)}`]])
                    + (k.unpriced_items ? `<div class="note warn">${k.unpriced_items} dispensed item${k.unpriced_items === 1 ? " has" : "s have"} no cost in the stock ledger, so ${k.unpriced_items === 1 ? "its" : "their"} cost shows as zero.</div>` : "")
                    + table("Cost by drug group", ["Group", "#Cost (KES)", "#Share"], d.by_group.map((r) => [r.group, money(r.cost), pct(r.percent)]).concat(d.by_group.length ? [["=", "TOTAL", money(k.dispensed_cost), "100%"]] : []), "Nothing was dispensed in this period.")
                    + table("Cost by item", ["Item", "Unit", "#Quantity", "#Unit cost", "#Cost (KES)", "#Share"], d.by_item.map((r) => [r.item, r.uom, qty(r.qty), money(r.unit_cost), money(r.cost), pct(r.percent)]), "Nothing was dispensed in this period.")
                    + table("Cost by department", ["Department", "#Cost (KES)", "#Share"], d.by_department.map((r) => [r.department, money(r.cost), pct(r.percent)]), "Nothing was dispensed in this period.")
                    + table("Cost by month", ["Month", "#Cost (KES)"], d.by_month.map((r) => [monthName(r.month), money(r.cost)]))
                    + table("Purchases in the period", ["Item", "Unit", "#Quantity", "#Value (KES)"], d.purchases.map((r) => [r.item, r.uom, qty(r.qty), money(r.value)]).concat(d.purchases.length ? [["=", "TOTAL", "", "", money(k.purchases)]] : []), "Nothing was purchased in this period.")
                    + `<div class="note">Cost is the stock-ledger value of the drugs that left the shelf when the pharmacist dispensed, not a list price.${k.other_issues ? ` A further KES ${money(k.other_issues)} was moved to first aid kits or issued otherwise.` : ""}</div>`,
            };
        },
        // ---- Insights views, printed from the same figures the Insights tabs show
        insight(d, view, scopeText) {
            const T = {
                overview: ["Overview", () => kpiTable("Key figures", d.kpis) + table("Top cases", ["Condition", "#Cases", "#Share %"], d.top_cases.map((r) => [r.condition, r.cases, r.share]), "No diagnoses recorded.")],
                health: ["Disease and Health", () => table("Conditions by month", ["Condition", ...d.labels, "#Total", "#Share %", "#Avg"], d.rows.map((r) => [r.condition, ...r.cells.map((c) => c || ""), r.total, r.percent, r.average]).concat(d.rows.length ? [["=", "TOTAL", ...d.col_totals, d.grand_total, 100, d.monthly_average]] : []), "No diagnoses recorded.")],
                visits: ["Clinic Visits", () => d.configured ? kpiTable("Key figures", d.kpis) + table("Most frequent visitors", ["Employee", "Department", "#Visits", "First in", "Last out", "#Minutes in clinic"], d.top_employees.map((r) => [r.employee_name, r.department || "", r.visits, r.first_in || "", r.last_out || "", r.minutes]), "No clinic visits.") : `<div class="note">${esc(d.reason || "Not set up.")}</div>`],
                sickoff: ["Sick-Off", () => kpiTable("Key figures", d.kpis) + table("Most sick days", ["Employee", "Staff no.", "Department", "#Episodes", "#Sick days"], d.top_employees.map((r) => [r.employee_name, r.staff_no || "", r.department || "", r.episodes, r.days]), "No sick-off records.") + table("Referred to other facilities", ["Facility", "#Visits", "#Employees", "#Sick-off days"], d.facilities.map((r) => [r.facility, r.visits, r.employees, r.sick_days]), "Nobody was referred out.")],
                investigations: ["Investigations", () => kpiTable("Key figures", d.kpis) + table("Requests by investigation", ["Investigation", ...d.statuses.map((s) => "#" + s), "#Total"], d.by_type.map((r) => [r.investigation, ...d.statuses.map((s) => r[s] || 0), r.total]), "No investigations requested.") + table("Abnormal and critical results", ["Date", "Employee", "Investigation", "Outcome", "Impression"], d.flagged.map((r) => [Print.day(r.at), r.patient_name, r.investigation, r.flag, r.impression || ""]), "No abnormal results.")],
                accidents: ["Accidents and Incidents", () => kpiTable("Key figures", d.kpis) + table("Records", ["Date", "Type", "Employee", "Department", "What", "Result", "Attended by"], d.records.map((r) => [r.at, r.source, r.employee_name || "", r.department || "", r.what || "", r.result || "", r.attended_by || ""]), "No accidents or incidents.")],
            };
            const [title, build] = T[view];
            return { title, right: `<b>${esc(scopeText)}</b>`, label: title, file: `${view}-${scopeText.replace(/\W+/g, "-").toLowerCase()}`, html: build() };
        },
    };

    // ------------------------------------------------------------ load
    let res;
    try {
        if (which === "insight") {
            const view = q.get("view"), year = q.get("year") || "", month = q.get("month") || "";
            if (!view) throw new Error("Choose a report.");
            const [dash, clinic, who] = await Promise.all([call("insights.dashboard", { view, year, month }), call("common.clinic_profile"), call("common.whoami", {}, { quiet: true })]);
            const scope = month ? `${MONTHS[Number(month) - 1]} ${year || new Date().getFullYear()}` : `Year ${year || new Date().getFullYear()}`;
            res = { clinic, printed_by: who.full_name, printed_on: new Date().toISOString(), doc: REPORTS.insight(dash.data, view, scope) };
        } else if (REPORTS[which]) {
            const r = await call("stockreports.report", { name: which, as_of: q.get("as_of") || null, month: q.get("month") || null, from_date: q.get("from") || null, to_date: q.get("to") || null });
            res = { clinic: r.clinic, printed_by: r.printed_by, printed_on: r.printed_on, doc: REPORTS[which](r.data) };
        } else throw new Error("Unknown report.");
    } catch (e) { msg.textContent = e.message || "The report could not be loaded."; return; }

    const doc = res.doc;
    document.title = `${doc.label} - ${doc.file.replace(/^.*?-/, "")}`.slice(0, 90);
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet">
        <div class="wm">MUTARA</div>
        ${Print.letterhead(res.clinic)}
        ${Print.titlebar(doc.title, `<div class="note" style="font-size:12px;text-align:right">${doc.right}</div>`)}
        ${doc.html}
        ${Print.footer({ clinic: res.clinic, printed_on: res.printed_on, printed_by: res.printed_by }, doc.label)}
    </article>`;
    msg.style.display = "none";
    btn.disabled = csvBtn.disabled = false;
    btn.addEventListener("click", () => window.print());
    csvBtn.addEventListener("click", () => {
        const text = csv.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
        a.download = `${doc.file}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    });
})();
