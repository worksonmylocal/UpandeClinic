/* Weekly duty rota on the clinic letterhead, landscape */
(async function () {
    const { call, esc } = Desk;
    const qs = new URLSearchParams(location.search), week = qs.get("week"), weeks = qs.get("weeks") || 1;
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!week) { msg.textContent = "No week selected."; return; }
    let d;
    try { d = await call("management.rota_document", { week_start: week, weeks }); } catch (e) { msg.textContent = e.message || "The rota could not be loaded."; return; }
    const nice = (iso, y) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", ...(y ? { year: "numeric" } : {}) });
    const c = d.clinic;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email)].filter(Boolean).join("<br>");
    const first_w = d.weeks[0], last_w = d.weeks[d.weeks.length - 1];
    document.title = `Duty Rota ${nice(first_w.week_start, 1)}${d.weeks.length > 1 ? " to " + nice(last_w.week_end, 1) : ""}`;
    document.getElementById("sheet-wrap").innerHTML = d.weeks.map((w, k) => { const r = w.rota; return `
    <article class="sheet land" ${k < d.weeks.length - 1 ? 'style="page-break-after:always"' : ""}>
        <header class="rh"><div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div><div class="rh__contact">${contact}</div></header>
        <div class="rule"></div>
        <div class="titlebar"><div><h1 style="font-size:20px">Clinical Duty Rota</h1><div class="rcpt-no">${esc(w.label)} &middot; ${esc(nice(w.week_start))} to ${esc(nice(w.week_end, 1))}</div></div>
            <div class="conf" style="border-color:var(--brand);color:var(--brand)">${esc(r.status)}</div></div>
        <table class="tbl rdoc rota-print"><thead><tr><th style="width:200px">Name</th>${w.days.map((x) => `<th class="r" style="text-align:center">${x.label}<br><span style="font-weight:400">${esc(nice(x.date))}</span></th>`).join("")}</tr></thead><tbody>
            ${r.rows.map((row) => `<tr><td><b>${esc(row.staff_name)}</b></td>${row.days.map((x) => `<td class="rc rc-${x || "e"}">${esc(x || "")}</td>`).join("")}</tr>`).join("")}
            <tr class="tot"><td>On call</td><td colspan="7"><b>${esc(r.on_call || "")}</b></td></tr>
        </tbody></table>
        <div class="note" style="margin-top:10px"><b>M</b> Morning shift (till evening) &nbsp; <b>A</b> Afternoon shift (till evening) &nbsp; <b>O</b> Off day &nbsp; <b>x</b> Not on duty</div>
        ${r.notes ? `<div class="note" style="margin-top:6px"><b>Notes:</b> ${esc(r.notes)}</div>` : ""}
        <div class="certify"><div><span class="sig"></span><small>Approved by · name, signature &amp; date</small></div><div></div></div>
        <footer class="foot"><div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>Duty rota</span></div></footer>
    </article>`; }).join("");
    const style = document.createElement("style");
    style.textContent = `@page{size:A4 landscape;margin:12mm 12mm 12mm}.rota-print td.rc{text-align:center;font:700 16px var(--sans);padding:9px 4px}
    .rc-M{background:#e8f3ec;color:#1a6b3a}.rc-A{background:#fff1d9;color:#9a5b00}.rc-O{background:#fde7e6;color:#c4302b}.rc-x{background:#f1f1ee;color:#999}`;
    document.head.appendChild(style);
    msg.style.display = "none"; btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
