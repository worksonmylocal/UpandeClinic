/* Any clinic report on the clinic letterhead, portrait or landscape, for printing or saving as PDF */
(async function () {
    const { call, esc, money } = Desk;
    const qs = new URLSearchParams(location.search);
    const report = qs.get("report");
    let filters = {};
    try { filters = JSON.parse(qs.get("f") || "{}"); } catch (e) { /* no filters */ }
    const msg = document.getElementById("msg"), btn = document.getElementById("print"), sel = document.getElementById("orient");
    if (!report) { msg.textContent = "No report selected."; return; }
    let d;
    try { d = await call("reports.run", { report, filters: JSON.stringify(filters) }); }
    catch (e) { msg.textContent = e.message || "The report could not be loaded."; return; }

    const dt = (v, time) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); if (isNaN(x)) return String(v); const day = x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); return time ? `${day}, ${x.toTimeString().slice(0, 5)}` : day; };
    const c = d.clinic, cols = d.columns;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    const isNum = (col) => ["Currency", "Int", "Float", "Percent"].includes(col.fieldtype);
    const fmt = (col, v) => {
        if (v == null || v === "") return "";
        if (col.fieldtype === "Currency") return money(v);
        if (col.fieldtype === "Date") return dt(v);
        if (col.fieldtype === "Datetime") return dt(v, true);
        if (col.fieldtype === "Check") return v ? "Yes" : "No";
        if (col.fieldtype === "Percent") return Number(v).toFixed(1) + "%";
        if (col.fieldtype === "Float") return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
        if (col.fieldtype === "Int") return Number(v).toLocaleString();
        return esc(v);
    };
    const isTotal = (r) => String(r[cols[0].fieldname] ?? "").toLowerCase() === "total" || r.bold;
    const count = d.rows.filter((r) => !isTotal(r)).length;
    const wideNeeded = d.wide || cols.length > 6;
    document.title = `${d.title}${d.filters_text ? " - " + d.filters_text : ""}`;

    const sum = d.summary.length ? `<div class="vgrid" style="grid-template-columns:repeat(${Math.min(d.summary.length, 5)},1fr);margin-bottom:12px">${d.summary.map((s) => `<div class="vt"><small>${esc(s.label)}</small><b>${s.datatype === "Currency" ? money(s.value) : esc(s.value)}</b></div>`).join("")}</div>` : "";
    const body = d.rows.length ? `<table class="tbl rdoc"><thead><tr>${cols.map((col) => `<th class="${isNum(col) ? "r" : ""}">${esc(col.label)}</th>`).join("")}</tr></thead><tbody>
        ${d.rows.map((r) => {
            const total = isTotal(r);
            return `<tr class="${total ? "tot" : ""}">${cols.map((col) => `<td class="${isNum(col) ? "r" : ""}">${fmt(col, r[col.fieldname])}</td>`).join("")}</tr>`;
        }).join("")}</tbody></table>` : '<div class="note" style="margin:14px 0">There is no data for these filters.</div>';

    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet" id="sheet">
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="titlebar"><div><h1 style="font-size:20px">${esc(d.title)}</h1>${d.filters_text ? `<div class="rcpt-no">${esc(d.filters_text)}</div>` : ""}</div>
            <div class="conf" style="border-color:var(--brand);color:var(--brand)">${count} row${count === 1 ? "" : "s"}</div></div>
        ${sum}${d.message && typeof d.message === "string" ? `<div class="note">${esc(d.message)}</div>` : ""}
        ${body}
        <footer class="foot"><div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>Printed ${esc(dt(d.printed_on, true))} by ${esc(d.printed_by || "")}</span></div></footer>
    </article>`;

    const style = document.createElement("style");
    document.head.appendChild(style);
    function orient() {
        const land = sel.value === "landscape" || (sel.value === "auto" && wideNeeded);
        document.getElementById("sheet").classList.toggle("land", land);
        style.textContent = `@page{size:A4 ${land ? "landscape" : "portrait"};margin:12mm 12mm 28mm}`;
    }
    sel.addEventListener("change", orient);
    orient();
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
