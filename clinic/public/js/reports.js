/* Reports: every clinic report in one place, each with a Download button (same letterhead as the medical documents) */
(async function () {
    const { $, $$, esc } = Desk;

    const who = await Desk.shell({
        page: "reports",
        eyebrow: "Mutara Clinic · Reports",
        title: "Reports",
        sub: "Every clinic report in one place. Pick the period, then download it.",
    });
    const can = (p) => who.pages.includes(p);
    const today = new Date(), iso = (d) => d.toISOString().slice(0, 10);
    const thisMonth = iso(today).slice(0, 7), monthStart = thisMonth + "-01";
    const years = [today.getFullYear(), today.getFullYear() - 1];

    // type: how the period is picked. href(values) builds the address of the printable report.
    const GROUPS = [
        {
            title: "Stock and cost",
            sub: "From the pharmacy stock ledger",
            show: () => can("insights") || can("pharmacy"),
            reports: [
                { name: "Stock Balance", about: "What is on the shelf: quantity, unit cost and value of every item, as of now or a past day.", color: "#228883",
                    field: { type: "date", key: "as_of", label: "As of (blank = now)", value: "", max: iso(today) },
                    href: (v) => `/clinic/reportdoc?report=stock_balance${v.as_of ? "&as_of=" + v.as_of : ""}` },
                { name: "Monthly Stock Report", about: "For a month: the items received and their quantities, what was dispensed, other issues, and the opening and closing stock.", color: "#2c6bb3",
                    field: { type: "month", key: "month", label: "Month", value: thisMonth, max: thisMonth },
                    href: (v) => `/clinic/reportdoc?report=stock_movement&month=${v.month}` },
                { name: "Cost Analysis", about: "What the drugs dispensed cost: by drug group, item, department and month, with purchases and the value of stock held.", color: "#e07a3a",
                    fields: [{ type: "date", key: "from", label: "From", value: monthStart }, { type: "date", key: "to", label: "To", value: iso(today), max: iso(today) }],
                    href: (v) => `/clinic/reportdoc?report=cost_analysis&from=${v.from}&to=${v.to}` },
            ],
        },
        {
            title: "Clinical reports",
            sub: "Prepared for the clinic's own records",
            show: () => can("consultation"),
            reports: [
                { name: "Clinical Officer Monthly Report", about: "The month's clinical activity: assessments, treatments, medical examinations, health education, emergencies and supplies.", color: "#8a4fd0",
                    field: { type: "month", key: "month", label: "Month", value: thisMonth, max: thisMonth },
                    href: (v) => `/clinic/monthly?month=${v.month}` },
                { name: "Weekly Clinic Activity Report", about: "One column per day for the week: patients seen, cases, referrals and stock.", color: "#b9770e",
                    field: { type: "date", key: "week", label: "Any day in the week", value: iso(today), max: iso(today) },
                    href: (v) => `/clinic/weekly?week=${v.week}` },
            ],
        },
        {
            title: "Insights reports",
            sub: "The Clinic Insights views, printable",
            show: () => can("insights"),
            reports: [
                ["overview", "Overview", "Consultations, visits, sick-off, investigations and accidents with the top cases."],
                ["health", "Disease and Health", "Every condition seen, month by month, with its share of the total."],
                ["visits", "Clinic Visits", "Biometric visits to the clinic: who came, when, and how long they stayed."],
                ["sickoff", "Sick-Off", "Sick days given, who had the most, and referrals to other facilities."],
                ["investigations", "Investigations", "Lab and imaging requests, their status and the abnormal results."],
                ["accidents", "Accidents and Incidents", "Accidents, incidents and first aid cases on the farm."],
            ].map(([view, name, about], i) => ({
                name, about, color: ["#2c6bb3", "#228883", "#5b4aa7", "#c4302b", "#b9770e", "#e07a3a"][i],
                fields: [{ type: "year", key: "year", label: "Year", value: years[0] }, { type: "monthpick", key: "month", label: "Month", value: "" }],
                href: (v) => `/clinic/reportdoc?report=insight&view=${view}&year=${v.year}${v.month ? "&month=" + v.month : ""}`,
            })),
        },
    ];

    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const input = (f, id) => {
        const base = `id="${id}" data-key="${f.key}"`;
        if (f.type === "year") return `<select ${base}>${years.map((y) => `<option>${y}</option>`).join("")}</select>`;
        if (f.type === "monthpick") return `<select ${base}><option value="">Whole year</option>${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>`;
        return `<input type="${f.type}" ${base} value="${esc(f.value || "")}"${f.max ? ` max="${f.max}"` : ""}>`;
    };

    let uid = 0;
    $("#list").innerHTML = GROUPS.filter((g) => g.show()).map((g) => `
        <div class="card">
            <div class="card__head"><h3>${esc(g.title)}</h3><span class="meta">${esc(g.sub)}</span></div>
            <div class="rep-list">${g.reports.map((r) => {
                const id = "r" + ++uid, fields = r.fields || [r.field];
                r.id = id;
                return `<div class="rep" id="${id}" style="--c:${r.color}">
                    <div class="rep__main"><b>${esc(r.name)}</b><span>${esc(r.about)}</span></div>
                    <div class="rep__fields">${fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${input(f, id + f.key)}</div>`).join("")}</div>
                    <button class="btn btn--primary btn--sm rep__go" data-r="${id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Download</button>
                </div>`;
            }).join("")}</div>
        </div>`).join("") || '<div class="card">You do not have a clinic role that can open reports.</div>';

    const byId = Object.fromEntries(GROUPS.flatMap((g) => g.reports).map((r) => [r.id, r]));
    $$(".rep__go").forEach((b) => b.addEventListener("click", () => {
        const r = byId[b.dataset.r], values = {};
        $$(`#${r.id} [data-key]`).forEach((el) => { values[el.dataset.key] = el.value; });
        if (r.fields && values.from && values.to && values.from > values.to) { Desk.toast("The From date is after the To date", "error"); return; }
        if (r.field && r.field.type === "month" && !values.month) { Desk.toast("Pick a month", "error"); return; }
        window.open(r.href(values), "_blank");
    }));
})();
