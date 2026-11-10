/* Pharmacy page: dispensing, payment, receipts and sick sheets */
(async function () {
    const { call, $, $$, esc, num, money, timeOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, banner, COLORS } = Desk;

    await Desk.shell({
        page: "pharmacy",
        eyebrow: "Northlake Medical Centre · Pharmacy",
        title: "Pharmacy",
        sub: "Dispense prescriptions, take payment and print receipts and sick sheets",
        tools: `<button class="btn btn--sm" id="monthly-inv" title="One invoice per farm for a month">Monthly farm invoice</button> <button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => tab === "insights" && loadInsights());
    const period = Desk.periodToggle($("#period"), () => loadInsights(), "month");
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });

    // one compounded invoice per farm for a month: each encounter's total per patient, and a grand total
    $("#monthly-inv").addEventListener("click", async () => {
        const m = await Desk.masters();
        const now = new Date(), thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        modal({
            title: "Monthly farm invoice",
            sub: "Everything invoiced to the farm in the month, one line per encounter, with a grand total.",
            body: `${field("mi_employer", "Farm", { type: "select", options: [{ value: "", label: "All farms (one invoice each)" }, ...(m.employers || []).map((e) => ({ value: e.name, label: e.name }))] })}
                ${field("mi_month", "Month", { type: "month", value: thisMonth, required: true })}`,
            foot: [{ label: "Cancel" }, { label: "Open invoice to download", cls: "btn--primary", onClick: (hh) => {
                const v = read(hh.body);
                if (!/^\d{4}-\d{2}$/.test(v.mi_month || "")) return toast("Choose the month", "warn");
                window.open(`/clinic/monthly_invoice?month=${encodeURIComponent(v.mi_month)}&employer=${encodeURIComponent(v.mi_employer || "")}`, "_blank");
                hh.close();
            } }],
        });
    });

    const receiptUrl = (bill) => `/clinic/receipt?bill=${encodeURIComponent(bill)}`;
    const invoiceUrl = (bill) => `/clinic/invoice?bill=${encodeURIComponent(bill)}`;
    const sheetUrl = (visit) => `/clinic/sicksheet?visit=${encodeURIComponent(visit)}`;
    const letterUrl = (visit) => `/clinic/referral_letter?visit=${encodeURIComponent(visit)}`;
    const letterBtn = (visit) => `<a class="btn btn--sm" target="_blank" href="${letterUrl(visit)}" title="Letter for the facility the patient is referred to">Referral letter</a> `;
    const MODES = ["Cash", "M-Pesa", "Bank / Card", "Other"];
    let dash;

    async function loadAll() {
        dash = await call("pharmacy.dashboard");
        const k = dash.kpis;
        kpis($("#kpis"), [
            { label: "Waiting at the Pharmacy", value: k.waiting, cls: k.waiting ? "warn" : "", unit: k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "No one waiting" },
            { label: "Collected Today", value: money(k.collected_today), cls: "good", unit: `${k.receipts_today} receipt${k.receipts_today === 1 ? "" : "s"} issued` },
            { label: "Dispensed Today", value: k.dispensed_today, unit: Desk.split(k.employees_today, k.community_today) },
            { label: "Items Dispensed", value: num(k.units_today), unit: `${k.lines_today} medicine lines today` },
            { label: "Invoiced to Farms", value: money(k.invoiced_today), cls: "info", unit: `${k.invoices_today} invoice${k.invoices_today === 1 ? "" : "s"} today` },
            { label: "Allergy Alerts", value: k.with_allergies, cls: k.with_allergies ? "bad" : "", unit: "Waiting patients with allergies on file" },
        ]);
        renderQueue(); renderDispensed();
        if ($("#tab-insights").classList.contains("on")) loadInsights();
    }

    function renderQueue() {
        const total = dash.pending.length + dash.payment_only.length;
        $("#queue-meta").textContent = total ? `${total} waiting` : "";
        const rx = dash.pending.map((r) => `
            <div class="qcard"><div class="qcard__stripe ${r.allergies ? "Emergency" : ""}"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}${r.employer ? " " + pill(r.employer, "mute") : ""}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))} · ${r.item_count} item(s) · ${esc(r.doctor_name || "—")}</div>
                ${r.diagnoses ? `<div class="qcard__note">${esc(r.diagnoses)}</div>` : ""}
                ${r.allergies ? `<div class="qcard__note alert">⚠ Allergy: ${esc(r.allergies)}</div>` : ""}
                ${r.referral ? `<div class="qcard__note" style="color:var(--info)">⇥ Referred to ${esc(r.referral)}: print the referral letter</div>` : ""}</div>
                <div class="qcard__side">${r.referral ? letterBtn(r.visit) : ""}${r.bill_total ? `<span class="tag tag--dest">${r.billing_mode === "Invoice" ? "Invoice " + money(r.bill_total) : money(r.bill_total) + " cash"}</span>` : ""}${wait(r.wait_minutes, 10, 25)}
                    <button class="btn btn--primary btn--sm" data-open="${esc(r.name)}">Dispense</button></div></div>`);
        const pay = dash.payment_only.map((r) => `
            <div class="qcard"><div class="qcard__stripe Urgent"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}${r.employer ? " " + pill(r.employer, "mute") : ""}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))} · nothing to dispense</div>
                <div class="qcard__note">${r.billing_mode === "Invoice" ? "Invoice only — nothing to dispense" : "Payment only"}</div>
                ${r.referral ? `<div class="qcard__note" style="color:var(--info)">⇥ Referred to ${esc(r.referral)}: print the referral letter</div>` : ""}</div>
                <div class="qcard__side">${r.referral ? letterBtn(r.visit) : ""}<span class="tag tag--dest">${r.billing_mode === "Invoice" ? "Invoice " + money(r.total) : money(r.total) + " cash"}</span>${wait(r.wait_minutes, 10, 25)}
                    <button class="btn btn--signal btn--sm" data-pay="${esc(r.visit)}">${r.billing_mode === "Invoice" ? "Issue invoice" : "Take payment"}</button></div></div>`);
        $("#queue").innerHTML = rx.length + pay.length ? rx.concat(pay).join("") : empty("No prescriptions or payments waiting.");
        $$("#queue [data-open]").forEach((b) => b.addEventListener("click", () => openDispensing(b.dataset.open)));
        $$("#queue [data-pay]").forEach((b) => b.addEventListener("click", () => openPayment(b.dataset.pay)));
    }

    function renderDispensed() {
        $("#dispensed").innerHTML = dash.dispensed.length ? `<table class="dtable"><tr><th>Time</th><th>Patient</th><th>Type</th><th class="num">Items</th><th>Billing</th><th>Pharmacist</th><th></th></tr>
            ${dash.dispensed.map((r) => `<tr><td>${timeOf(r.dispensed_on)}</td><td><b style="color:var(--ink)">${esc(r.patient_name)}</b></td><td>${typeTag(r.patient_type)}</td>
                <td class="num">${r.item_count}</td>
                <td>${r.bill ? `${money(r.bill.total)} ${r.bill.status === "Invoiced" ? pill("Invoiced", "info") : pill("Paid", "good")}<br><span class="printnote">${esc(r.bill.invoice_no || r.bill.receipt_no || "")}</span>` : "—"}</td>
                <td>${esc(r.pharmacist_name || "")}</td>
                <td class="num">${r.bill && r.bill.invoice_no ? `<a class="btn btn--sm" target="_blank" href="${invoiceUrl(r.bill.name)}">Invoice</a> ` : ""}${r.bill && r.bill.receipt_no ? `<a class="btn btn--sm" target="_blank" href="${receiptUrl(r.bill.name)}">Receipt</a> ` : ""}${r.sick_sheet ? `<a class="btn btn--sm" target="_blank" href="${sheetUrl(r.visit)}">Sick sheet</a> ` : ""}${r.referral ? letterBtn(r.visit) : ""}<button class="btn btn--link btn--sm" data-open="${esc(r.name)}">View</button></td></tr>`).join("")}</table>`
            : empty("Nothing dispensed yet today.");
        $$("#dispensed [data-open]").forEach((b) => b.addEventListener("click", () => openDispensing(b.dataset.open)));
    }

    async function loadInsights() {
        const d = await call("pharmacy.insights", { period: period.value });
        const WORD = { day: "today", week: "this week", month: "this month" }[period.value];
        const P = Desk.PALETTE, t = d.totals, drugs = d.top_drugs;
        $("#range-meta").textContent = d.range.from === d.range.to ? Desk.dateOf(d.range.from) : `${d.range.from} → ${d.range.to}`;
        const ico = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
        Desk.livelyTiles($("#drug-totals"), [
            { label: "Prescriptions filled", value: t.dispensings, unit: WORD, color: P[0], icon: ico('<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>') },
            { label: "Units dispensed", value: Math.round(t.units), unit: "all drugs", color: P[2], icon: ico('<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/>') },
            { label: "Different drugs", value: t.drugs, unit: "handed out", color: P[1], icon: ico('<path d="M12 3l9 5v8l-9 5-9-5V8z"/>') },
        ]);
        $("#drug-meta").textContent = drugs.length ? `Top ${drugs.length} · units handed out ${WORD}` : "";
        Desk.ranked($("#top-drugs"), drugs.map((r) => ({ label: r.label, value: r.qty, sub: `${r.prescriptions}× · ${r.patients} patient${r.patients === 1 ? "" : "s"}` })));
        const units = drugs.reduce((a, r) => a + Number(r.qty), 0);
        $("#drug-mid").innerHTML = `<b>${num(Math.round(units))}</b><span>Units</span>`;
        chart("drug-chart", { type: "doughnut", data: { labels: drugs.map((r) => r.label), datasets: [{ data: drugs.length ? drugs.map((r) => r.qty) : [1], backgroundColor: drugs.length ? drugs.map((_, i) => P[i % P.length]) : ["rgba(10,10,10,0.06)"], borderWidth: 4, borderColor: "#fff", hoverOffset: 8, borderRadius: 8 }] }, options: { cutout: "68%", plugins: { legend: { display: false }, tooltip: { enabled: drugs.length > 0 } } } });
    }

    // ------------------------------------------------------------ bill + payment widgets
    function billPanel(lines, total) {
        return `<div class="billbox">
            <table class="rtable"><tr><th>Charge</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr>
                ${lines.length ? lines.map((l) => `<tr><td>${esc(l.description)} ${l.item_type === "Consultation" ? "" : `<span class="printnote">${esc(l.item_type)}</span>`}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${money(l.rate)}</td><td style="text-align:right"><b>${money(l.amount)}</b></td></tr>`).join("")
                    : '<tr><td colspan="4" class="printnote">No charges</td></tr>'}
                <tr class="billtotal"><td colspan="3">Total due</td><td style="text-align:right">${money(total)}</td></tr></table></div>`;
    }
    function paymentFields(total) {
        return `<div class="grid-3" id="pay-fields">
            ${field("pay_mode", "Payment method", { type: "select", options: MODES })}
            ${field("pay_amount", "Amount received (KSh)", { type: "number", value: total, attrs: 'step="0.01" min="0"' })}
            ${field("pay_reference", "Reference", { placeholder: "M-Pesa code (optional)" })}
        </div><div class="liveinfo ok" id="pay-change" style="display:none"></div>`;
    }
    function bindPayment(root, getTotal) {
        const amount = $("[data-f=pay_amount]", root), out = $("#pay-change", root);
        const update = () => {
            const diff = Number(amount.value || 0) - getTotal();
            out.style.display = getTotal() > 0 ? "" : "none";
            out.className = "liveinfo " + (diff >= 0 ? "ok" : "");
            out.textContent = diff >= 0 ? `Change to give: ${money(diff)}` : `Short by ${money(-diff)}`;
        };
        amount.addEventListener("input", update); update();
        return update;
    }
    const paymentValues = (root) => { const v = read(root); return { mode: v.pay_mode, amount: v.pay_amount, reference: v.pay_reference }; };

    function printDialog({ patient, bill, document, visit, sickSheet, referral }) {
        const invoice = document === "invoice";
        modal({
            title: invoice ? "Invoice issued" : bill ? "Payment received" : "Dispensed",
            sub: esc(patient),
            body: `<div class="liveinfo ok">${invoice ? "Invoice raised for the employer. The medicines are handed over." : bill ? "Payment recorded and the medicines are handed over." : "Medicines handed over."} The visit is complete.</div>
                <p style="margin:0;color:var(--ink-3)">${invoice ? "Print the invoice (and sick sheet) for the employee to take back to the farm:" : "Print the documents for the patient:"}</p>`,
            foot: [
                { label: "Close" },
                ...(referral ? [{ label: "Print referral letter", cls: bill || sickSheet ? "" : "btn--primary", onClick: () => { window.open(letterUrl(visit), "_blank"); } }] : []),
                ...(sickSheet ? [{ label: "Print sick sheet", cls: bill ? "" : "btn--primary", onClick: () => { window.open(sheetUrl(visit), "_blank"); } }] : []),
                ...(bill ? [{ label: invoice ? "Print invoice" : "Print receipt", cls: "btn--primary", onClick: () => { window.open(invoice ? invoiceUrl(bill) : receiptUrl(bill), "_blank"); } }] : []),
            ],
        });
    }

    // ------------------------------------------------------------ dispensing
    async function openDispensing(name) {
        const d = await call("pharmacy.get_dispensing", { name });
        const done = d.docstatus === 1;
        const p = d.patient_card;
        const fixedLines = d.bill ? d.bill.lines.filter((l) => l.item_type !== "Drug") : [];
        const invoiceMode = d.billing_mode === "Invoice";

        const h = modal({
            title: done ? "Dispensed" : "Dispense medication",
            sub: `${esc(d.name)} · ${esc(d.visit)} · prescribed by ${esc(d.doctor_name || "—")}`,
            size: "wide",
            body: `${banner(p, { extra: d.weight_kg ? `<span class="flag flag--info">${d.weight_kg} kg</span>` : "" })}
                ${p.allergies ? `<div class="liveinfo" style="background:var(--bad-bg);color:var(--bad)">⚠ Known allergies: <b>${esc(p.allergies)}</b> — check every item before dispensing.</div>` : ""}
                ${d.diagnoses.length ? `<div class="printnote" style="margin-bottom:14px">Diagnosis: ${d.diagnoses.map(esc).join(", ")}</div>` : ""}
                <table class="rtable"><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Days</th><th>Prescribed</th><th style="width:110px">${done ? "Dispensed" : "Dispense qty"}</th>${done ? "" : '<th title="Patient will buy this from a pharmacy of their choice">Not in stock</th>'}</tr>
                ${d.items.map((r) => `<tr data-item-row="${esc(r.name)}"><td><b style="color:var(--ink)">${esc(r.drug_name || r.drug)}</b>${d.prices[r.drug] ? ` <span class="pill info">${(d.courses[r.drug] || {}).course_qty > 1 ? `${money(d.courses[r.drug].price)} per course of ${d.courses[r.drug].course_qty}` : `${money(d.prices[r.drug])}/unit`}</span>` : ""}
                    ${r.route && r.route !== "Oral" ? `<br><span class="printnote">${esc(r.route)}</span>` : ""}${r.instructions ? `<br><span class="printnote">${esc(r.instructions)}</span>` : ""}</td>
                    <td>${esc(r.dose || "")}</td><td>${esc(r.frequency || "")}</td><td>${r.duration_days || ""}</td>
                    <td>${r.prescribed_qty} ${esc(r.uom || "")}</td>
                    <td>${done ? (r.not_available ? pill("Buy externally", "warn") : `<b>${r.dispensed_qty}</b>`) : `<input type="number" min="0" step="any" data-item="${esc(r.name)}" value="${r.dispensed_qty}">`}</td>
                    ${done ? "" : `<td><input type="checkbox" data-na="${esc(r.name)}" ${r.not_available ? "checked" : ""} style="width:18px;height:18px"></td>`}</tr>`).join("")}</table>
                ${done ? "" : '<div class="printnote" style="margin-top:8px">Tick <b>Not in stock</b> when the drug is unavailable: it is not charged, and the patient is told to buy it from a pharmacy of their choice.</div>'}
                <div style="margin-top:16px">${field("notes", "Pharmacy notes", { type: "textarea", rows: 2, value: d.notes, attrs: done ? "disabled" : "", placeholder: "Substitutions, counselling given…" })}</div>
                ${!done ? `<div class="subhead" style="margin-top:22px">${invoiceMode ? "Invoice" : "Bill &amp; payment"}</div><div id="bill-box"></div>${invoiceMode
                    ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Charged to <b>${esc(d.employer || "the employer")}</b> on an invoice. No money is taken here: the employee carries the invoice back to the farm, which pays later.</div>`
                    : paymentFields(0)}` : ""}
                ${done && d.bill ? `<div class="subhead" style="margin-top:22px">Bill</div>${billPanel(d.bill.lines, d.bill.total)}<div class="printnote">${d.bill.invoice_no ? "Invoice " + esc(d.bill.invoice_no) + (d.bill.status === "Paid" ? " · paid by the farm" : " · awaiting payment by the farm") : d.bill.status === "Paid" ? "Paid · receipt " + esc(d.bill.receipt_no || "") : "Unpaid"}</div>` : ""}`,
            foot: done
                ? [{ label: "Close" },
                   ...(d.bill && d.bill.invoice_no ? [{ label: "Print invoice", onClick: () => { window.open(invoiceUrl(d.bill.name), "_blank"); } }] : []),
                   ...(d.bill && d.bill.receipt_no ? [{ label: "Print receipt", onClick: () => { window.open(receiptUrl(d.bill.name), "_blank"); } }] : []),
                   ...(d.referral ? [{ label: "Print referral letter", onClick: () => { window.open(letterUrl(d.visit), "_blank"); } }] : []),
                   ...(d.sick_sheet ? [{ label: "Print sick sheet", cls: "btn--primary", onClick: () => { window.open(sheetUrl(d.visit), "_blank"); } }] : [])]
                : [{ label: "Close" }, ...(d.referral ? [{ label: "Print referral letter", onClick: () => { window.open(letterUrl(d.visit), "_blank"); } }] : []), { label: "Save", onClick: (hh) => submit(hh, 0) },
                   { label: invoiceMode ? "Issue invoice & dispense ✓" : "Take payment & dispense ✓", cls: "btn--primary", onClick: (hh) => submit(hh, 1) }],
        });
        if (done) return;

        const collect = () => $$("[data-item]", h.body).map((i) => ({
            name: i.dataset.item, dispensed_qty: i.value, not_available: $(`[data-na="${CSS.escape(i.dataset.item)}"]`, h.body).checked ? 1 : 0,
        }));
        let updatePay = () => {};
        let currentTotal = 0;
        const recalc = () => {
            const drugLines = collect().map((it) => {
                const row = d.items.find((x) => x.name === it.name), rate = d.prices[row.drug] || 0, qty = it.not_available ? 0 : Number(it.dispensed_qty || 0);
                return rate && qty ? { item_type: "Drug", description: row.drug_name || row.drug, qty, rate, amount: qty * rate } : null;
            }).filter(Boolean);
            const lines = fixedLines.concat(drugLines);
            currentTotal = lines.reduce((s, l) => s + l.amount, 0);
            $("#bill-box", h.body).innerHTML = billPanel(lines, currentTotal);
            const amount = $("[data-f=pay_amount]", h.body);
            if (amount) { if (!amount.dataset.touched) amount.value = currentTotal; updatePay(); }
        };
        {
            if (!invoiceMode) {
                updatePay = bindPayment(h.body, () => currentTotal);
                $("[data-f=pay_amount]", h.body).addEventListener("input", (e) => (e.target.dataset.touched = 1));
            }
            $$("[data-item],[data-na]", h.body).forEach((i) => i.addEventListener("input", recalc));
            $$("[data-na]", h.body).forEach((i) => i.addEventListener("change", () => {
                const qty = $(`[data-item="${CSS.escape(i.dataset.na)}"]`, h.body);
                if (i.checked) { qty.dataset.was = qty.value; qty.value = 0; } else if (qty.dataset.was) qty.value = qty.dataset.was;
                recalc();
            }));
            recalc();
        }

        async function submit(hh, finalise) {
            const items = collect();
            const notes = read(hh.body).notes;
            if (finalise) {
                if (items.every((i) => !Number(i.dispensed_qty) && !i.not_available)) return toast("Enter the quantities dispensed", "warn");
                const short = items.filter((i) => !i.not_available && Number(i.dispensed_qty) < Number(d.items.find((x) => x.name === i.name).prescribed_qty));
                if (short.length && !confirm(`${short.length} item(s) are being dispensed below the prescribed quantity. Continue?`)) return;
                if (!invoiceMode && currentTotal > 0 && Number(read(hh.body).pay_amount || 0) < currentTotal) return toast(`Amount received is less than the total due (${money(currentTotal)})`, "warn");
            }
            const r = await call("pharmacy.dispense", { name, items, notes, submit: finalise, payment: !invoiceMode && finalise ? paymentValues(hh.body) : null });
            hh.close();
            loadAll();
            if (!finalise) return toast("Saved");
            toast(r.document === "invoice" ? "Invoice issued and dispensed. Visit completed." : r.bill ? "Paid and dispensed. Visit completed." : "Dispensed. Visit completed.");
            if (r.bill || r.sick_sheet || r.referral) printDialog({ patient: p.full_name, bill: r.bill, document: r.document, visit: r.visit, sickSheet: r.sick_sheet, referral: r.referral });
        }
    }

    // ------------------------------------------------------------ payment only
    async function openPayment(visit) {
        const d = await call("pharmacy.get_payment", { visit });
        const total = d.bill ? d.bill.total : 0;
        const invoiceMode = d.billing_mode === "Invoice";
        const h = modal({
            title: invoiceMode ? "Issue invoice" : "Take payment",
            sub: `${esc(visit)} · nothing to dispense`,
            body: `${banner(d.patient_card)}${billPanel(d.bill ? d.bill.lines : [], total)}<div style="margin-top:16px">${invoiceMode
                ? `<div class="liveinfo" style="background:var(--info-bg);color:var(--info)">Charged to <b>${esc(d.employer || "the employer")}</b> on an invoice. The employee takes it back to the farm, which pays later.</div>`
                : paymentFields(total)}</div>`,
            foot: [{ label: "Close" }, ...(d.referral ? [{ label: "Print referral letter", onClick: () => { window.open(letterUrl(visit), "_blank"); } }] : []), { label: invoiceMode ? "Issue invoice ✓" : "Take payment ✓", cls: "btn--primary", onClick: async (hh) => {
                let r;
                if (invoiceMode) r = await call("pharmacy.issue_invoice", { visit });
                else {
                    const pv = paymentValues(hh.body);
                    if (Number(pv.amount || 0) < total) return toast(`Amount received is less than the total due (${money(total)})`, "warn");
                    r = await call("pharmacy.take_payment", { visit, payment: pv });
                }
                hh.close(); loadAll(); toast(invoiceMode ? "Invoice issued. Visit completed." : "Payment received. Visit completed.");
                printDialog({ patient: d.patient_card.full_name, bill: r.bill, document: r.document, visit, sickSheet: r.sick_sheet, referral: r.referral });
            } }],
        });
        if (!invoiceMode) bindPayment(h.body, () => total);
    }

    await loadAll();
    Desk.poll(loadAll);
})();
