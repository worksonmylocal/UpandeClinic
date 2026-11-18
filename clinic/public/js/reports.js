/* Reports tab: every report in one list; Download asks for the filters then opens the report on the clinic letterhead */
(async function () {
    const { call, $, $$, esc, modal, empty } = Desk;
    await Desk.shell({
        page: "reports",
        eyebrow: "Northlake Medical Centre · Records",
        title: "Reports",
        sub: "Every clinic report, ready to download on the clinic letterhead",
        tools: "",
    });

    const d = await call("reports.list_reports");
    const today = new Date();
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const defaults = {
        today: () => iso(today),
        month_start: () => iso(new Date(today.getFullYear(), today.getMonth(), 1)),
        months_ago_3: () => iso(new Date(today.getFullYear(), today.getMonth() - 3, today.getDate())),
        months_ago_24: () => iso(new Date(today.getFullYear() - 2, today.getMonth(), today.getDate())),
    };
    const groups = [...new Set(d.reports.map((r) => r.group))];
    $("#rp").innerHTML = d.reports.length ? groups.map((g) => `
        <div class="card" style="margin-bottom:18px"><div class="card__head"><h3>${esc(g)}</h3></div>
        <div class="tscroll"><table class="table"><tbody>
            ${d.reports.filter((r) => r.group === g).map((r) => `<tr>
                <td style="width:34%"><b>${esc(r.name)}</b></td>
                <td>${esc(r.description)}${r.wide ? ' <span class="pill mute">Landscape</span>' : ""}</td>
                <td style="width:150px;text-align:right"><button class="btn btn--primary btn--sm" data-dl="${esc(r.name)}">Download</button></td></tr>`).join("")}
        </tbody></table></div></div>`).join("") : empty("No reports are open to your role.");

    function fieldHtml(f) {
        const id = `data-f="${f.fieldname}"`;
        if (f.type === "date") return `<div class="field"><label>${esc(f.label)}</label><input type="date" ${id} value="${defaults[f.default] ? defaults[f.default]() : ""}"></div>`;
        if (f.type === "select") return `<div class="field"><label>${esc(f.label)}</label><select ${id}>${f.options.map((o) => `<option ${o === f.default ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
        if (f.type === "farm") return `<div class="field"><label>${esc(f.label)}</label><select ${id}><option value="">All farms</option>${d.farms.map((o) => `<option>${esc(o)}</option>`).join("")}</select></div>`;
        if (f.type === "check") return `<div class="field"><label><input type="checkbox" ${id}> ${esc(f.label)}</label></div>`;
        if (f.type === "int") return `<div class="field"><label>${esc(f.label)}</label><input type="number" min="0" ${id} value="${f.default ?? ""}"></div>`;
        return "";
    }

    $$("[data-dl]").forEach((b) => b.addEventListener("click", () => {
        const r = d.reports.find((x) => x.name === b.dataset.dl);
        const m = modal({
            title: r.name,
            sub: esc(r.description),
            body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${r.filters.map(fieldHtml).join("")}</div>
                <div class="printnote" style="margin-top:12px">The report opens on the clinic letterhead${r.wide ? ", in landscape because it is wide" : ""}. Choose <b>Save as PDF</b> to download it.</div>`,
            foot: [{ label: "Cancel" }, { label: "Download", cls: "btn--primary", onClick: (hh) => {
                const f = {};
                $$("[data-f]", m.body).forEach((i) => {
                    const v = i.type === "checkbox" ? (i.checked ? 1 : "") : i.value;
                    if (v !== "" && v != null) f[i.dataset.f] = v;
                });
                window.open(`/clinic/reportdoc?report=${encodeURIComponent(r.name)}&f=${encodeURIComponent(JSON.stringify(f))}`, "_blank");
                hh.close();
            } }],
        });
    }));
})();
