/* Pharmacy page: dispensing */
(async function () {
    const { call, $, $$, esc, num, timeOf, wait, typeTag, pill, ageSex, empty, toast, kpis, hbars, chart, modal, field, read, banner } = Desk;

    await Desk.shell({
        page: "pharmacy",
        eyebrow: "Mutara Clinic · Pharmacy",
        title: "Pharmacy",
        sub: "Dispense the prescriptions written by the doctor",
        tools: `<button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs((tab) => tab === "insights" && loadInsights());
    $("#refresh").addEventListener("click", () => { loadAll(); toast("Refreshed"); });

    let dash;
    const period = Desk.periodToggle($("#period"), () => loadInsights(), "month");

    async function loadAll() {
        dash = await call("pharmacy.dashboard");
        const k = dash.kpis;
        kpis($("#kpis"), [
            { label: "Waiting at the Pharmacy", value: k.waiting, cls: k.waiting ? "warn" : "", unit: k.waiting ? `Longest wait ${Desk.duration(k.longest_wait)}` : "No one waiting" },
            { label: "Dispensed Today", value: k.dispensed_today, cls: "good", unit: Desk.split(k.employees_today) },
            { label: "Items Dispensed", value: num(k.units_today), unit: `${k.lines_today} medicine lines today` },
            { label: "Avg Wait", value: Desk.duration(k.avg_wait), unit: "Prescription to dispensing" },
            { label: "Allergy Alerts", value: k.with_allergies, cls: k.with_allergies ? "bad" : "", unit: "Waiting patients with allergies on file" },
        ]);
        renderQueue(); renderDispensed();
        if ($("#tab-insights").classList.contains("on")) loadInsights();
    }

    function renderQueue() {
        $("#queue-meta").textContent = dash.pending.length ? `${dash.pending.length} waiting` : "";
        $("#queue").innerHTML = dash.pending.length ? dash.pending.map((r) => `
            <div class="qcard"><div class="qcard__stripe ${r.allergies ? "Emergency" : ""}"></div>
                <div><div class="qcard__name">${esc(r.patient_name)} ${typeTag(r.patient_type)}</div>
                <div class="qcard__meta">${esc(r.visit)} · ${esc(ageSex(r))} · ${r.item_count} item(s) · ${esc(r.doctor_name || "—")}</div>
                ${r.diagnoses ? `<div class="qcard__note">${esc(r.diagnoses)}</div>` : ""}
                ${r.allergies ? `<div class="qcard__note alert">⚠ Allergy: ${esc(r.allergies)}</div>` : ""}</div>
                <div class="qcard__side">${wait(r.wait_minutes, 10, 25)}
                    <button class="btn btn--primary btn--sm" data-open="${esc(r.name)}">Dispense</button></div></div>`).join("")
            : empty("No prescriptions waiting.");
        $$("#queue [data-open]").forEach((b) => b.addEventListener("click", () => openDispensing(b.dataset.open)));
    }

    function renderDispensed() {
        $("#dispensed").innerHTML = dash.dispensed.length ? `<table class="dtable"><tr><th>Time</th><th>Patient</th><th>Type</th><th class="num">Items</th><th>Pharmacist</th><th></th></tr>
            ${dash.dispensed.map((r) => `<tr><td>${timeOf(r.dispensed_on)}</td><td><b style="color:var(--ink)">${esc(r.patient_name)}</b></td><td>${typeTag(r.patient_type)}</td>
                <td class="num">${r.item_count}</td><td>${esc(r.pharmacist_name || "")}</td>
                <td class="num"><button class="btn btn--link btn--sm" data-open="${esc(r.name)}">View</button></td></tr>`).join("")}</table>`
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

    // ------------------------------------------------------------ dispensing
    async function openDispensing(name) {
        const d = await call("pharmacy.get_dispensing", { name });
        const done = d.docstatus === 1;
        const p = d.patient_card;

        const h = modal({
            title: done ? "Dispensed" : "Dispense medication",
            sub: `${esc(d.name)} · ${esc(d.visit)} · prescribed by ${esc(d.doctor_name || "—")}`,
            size: "wide",
            body: `${banner(p, { extra: d.weight_kg ? `<span class="flag flag--info">${d.weight_kg} kg</span>` : "" })}
                ${p.allergies ? `<div class="liveinfo" style="background:var(--bad-bg);color:var(--bad)">⚠ Known allergies: <b>${esc(p.allergies)}</b> — check every item before dispensing.</div>` : ""}
                ${d.diagnoses.length ? `<div class="printnote" style="margin-bottom:14px">Diagnosis: ${d.diagnoses.map(esc).join(", ")}</div>` : ""}
                <table class="rtable"><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Days</th><th>Prescribed</th><th style="width:110px">${done ? "Dispensed" : "Dispense qty"}</th>${done ? "" : '<th title="Patient will buy this from a pharmacy of their choice">Not in stock</th>'}</tr>
                ${d.items.map((r) => `<tr><td><b style="color:var(--ink)">${esc(r.drug_name || r.drug)}</b>
                    ${r.route && r.route !== "Oral" ? `<br><span class="printnote">${esc(r.route)}</span>` : ""}${r.instructions ? `<br><span class="printnote">${esc(r.instructions)}</span>` : ""}</td>
                    <td>${esc(r.dose || "")}</td><td>${esc(r.frequency || "")}</td><td>${r.duration_days || ""}</td>
                    <td>${r.prescribed_qty} ${esc(r.uom || "")}${done ? "" : `<br><span class="printnote">${num(d.stock[r.drug] || 0)} on shelf</span>`}</td>
                    <td>${done ? (r.not_available ? pill("Buy externally", "warn") : `<b>${r.dispensed_qty}</b>`) : `<input type="number" min="0" step="any" data-item="${esc(r.name)}" value="${r.dispensed_qty}">`}</td>
                    ${done ? "" : `<td><input type="checkbox" data-na="${esc(r.name)}" ${r.not_available ? "checked" : ""} style="width:18px;height:18px"></td>`}</tr>`).join("")}</table>
                ${done ? "" : '<div class="printnote" style="margin-top:8px">Tick <b>Not in stock</b> when the drug is unavailable: the patient is told to buy it from a pharmacy of their choice.</div>'}
                <div style="margin-top:16px">${field("notes", "Pharmacy notes", { type: "textarea", rows: 2, value: d.notes, attrs: done ? "disabled" : "", placeholder: "Substitutions, counselling given…" })}</div>`,
            foot: done
                ? [{ label: "Close" }]
                : [{ label: "Close" }, { label: "Save", onClick: (hh) => submit(hh, 0) }, { label: "Dispense ✓", cls: "btn--primary", onClick: (hh) => submit(hh, 1) }],
        });
        if (done) return;

        $$("[data-na]", h.body).forEach((i) => i.addEventListener("change", () => {
            const qty = $(`[data-item="${CSS.escape(i.dataset.na)}"]`, h.body);
            if (i.checked) { qty.dataset.was = qty.value; qty.value = 0; } else if (qty.dataset.was) qty.value = qty.dataset.was;
        }));
        const collect = () => $$("[data-item]", h.body).map((i) => ({
            name: i.dataset.item, dispensed_qty: i.value, not_available: $(`[data-na="${CSS.escape(i.dataset.item)}"]`, h.body).checked ? 1 : 0,
        }));

        async function submit(hh, finalise) {
            const items = collect();
            const notes = read(hh.body).notes;
            if (finalise) {
                if (items.every((i) => !Number(i.dispensed_qty) && !i.not_available)) return toast("Enter the quantities dispensed", "warn");
                const short = items.filter((i) => !i.not_available && Number(i.dispensed_qty) < Number(d.items.find((x) => x.name === i.name).prescribed_qty));
                if (short.length && !confirm(`${short.length} item(s) are being dispensed below the prescribed quantity. Continue?`)) return;
            }
            await call("pharmacy.dispense", { name, items, notes, submit: finalise });
            hh.close();
            loadAll();
            toast(finalise ? "Dispensed. Visit completed." : "Saved");
        }
    }

    await loadAll();
    Desk.poll(loadAll);
})();
