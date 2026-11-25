/* Monthly invoice per farm: one line per employee split into consultation / lab / pharmacy cost, with column totals, laid out for A4 printing */
(async function () {
    const { call, esc, money } = Desk;
    const qs = new URLSearchParams(location.search);
    const month = qs.get("month"), employer = qs.get("employer") || "";
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!month) { msg.textContent = "No month selected."; return; }
    let d;
    try { d = await call("documents.monthly_invoice", { month, employer }); } catch (e) { msg.textContent = e.message || "The invoice could not be loaded."; return; }
    const dt = (v, time) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); if (isNaN(x)) return String(v); const day = x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); return time ? day + ", " + x.toTimeString().slice(0, 5) : day; };
    const c = d.clinic;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    const COLS = [["consultation", "Consultation"], ["procedures", "Procedures"], ["lab", "Lab"], ["pharmacy", "Pharmacy"]];
    const ref = (farm) => `MI-${d.month.replace("-", "")}-${String(farm.employer || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 6).toUpperCase()}`;

    if (!d.farms.length) { msg.textContent = `No farm invoices were raised in ${d.period}.`; return; }
    document.title = `Monthly Invoice ${d.period}${employer ? " - " + employer : ""}`;
    document.getElementById("sheet-wrap").innerHTML = d.farms.map((f, i) => `
    <article class="sheet" ${i < d.farms.length - 1 ? 'style="page-break-after:always"' : ""}>
        <div class="wm" style="font-size:80px">INVOICE</div>
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="titlebar"><div><h1>Monthly Invoice</h1><div class="rcpt-no">No. ${esc(ref(f))}</div></div>
            <div class="conf" style="border-color:var(--brand);color:var(--brand)">Payable by employer</div></div>
        <section class="meta">
            <dl><dt>Bill to</dt><dd class="big">${esc((f.details && f.details.employer_name) || f.employer || "—")}</dd>
                ${f.details && f.details.address ? `<dt>Address</dt><dd style="white-space:pre-line">${esc(f.details.address)}</dd>` : ""}
                ${f.details && f.details.contact_person ? `<dt>Attention</dt><dd>${esc(f.details.contact_person)}${f.details.phone ? " · " + esc(f.details.phone) : ""}</dd>` : ""}</dl>
            <dl><dt>Period</dt><dd class="big">${esc(d.period)}</dd><dt>Employees</dt><dd>${f.employees}</dd><dt>Encounters</dt><dd>${f.count}</dd><dt>Invoice date</dt><dd>${esc(dt(d.printed_on))}</dd></dl>
        </section>
        ${f.rows.length ? (() => {
            const cols = COLS.filter(([k]) => k !== "procedures" || f.totals.procedures > 0);
            return `<table class="tbl" style="margin-top:6px"><thead><tr><th style="width:44px">No.</th><th>Name</th>${cols.map(([, label]) => `<th class="r" style="width:105px">${label}</th>`).join("")}<th class="r" style="width:115px">Total</th></tr></thead><tbody>
            ${f.rows.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.patient_name)}</td>${cols.map(([key]) => `<td class="r">${money(r[key])}</td>`).join("")}<td class="r"><b>${money(r.total)}</b></td></tr>`).join("")}
            <tr class="grand"><td></td><td><b>Total</b></td>${cols.map(([key]) => `<td class="r"><b>${money(f.totals[key])}</b></td>`).join("")}<td class="r"><b>${money(f.totals.total)}</b></td></tr>
        </tbody></table>`;
        })() + `<table class="totals"><tr class="grand"><td>Grand total</td><td style="text-align:right">${money(f.total)}</td></tr></table>
        ${f.paid_total ? `<div class="note" style="margin-top:6px">Of this, ${money(f.paid_total)} has already been paid by the farm.</div>` : ""}`
        : '<div class="note" style="margin:14px 0">No encounters were invoiced to this farm in the month.</div>'}
        <div class="sec" style="margin-top:18px"><h2>Terms &amp; how to pay</h2><div class="body"><div class="note" style="white-space:pre-line">${esc(d.terms || "Payable by the employer on presentation of this invoice.")}${d.payment_details ? "\n\n" + esc(d.payment_details) : ""}</div></div></div>
        <div class="certify"><div><span class="sig"></span><small>Received by (farm) · name, signature &amp; date</small></div><div><div class="stamp-box">Farm stamp</div></div></div>
        <footer class="foot"><div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>Printed ${esc(dt(d.printed_on, true))} by ${esc(d.printed_by)} · ${esc(ref(f))}</span></div></footer>
    </article>`).join("");
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
