/* Payment receipt */
(async function () {
    const { call, esc, money } = Desk;
    const bill = new URLSearchParams(location.search).get("bill");
    const msg = document.getElementById("msg"), btn = document.getElementById("print");
    if (!bill) { msg.textContent = "No bill selected."; return; }
    let d;
    try { d = await call("documents.receipt", { bill }); } catch (e) { msg.textContent = e.message || "The receipt could not be loaded."; return; }
    const dt = (v) => { if (!v) return ""; const x = new Date(String(v).replace(" ", "T")); return isNaN(x) ? String(v) : x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + ", " + x.toTimeString().slice(0, 5); };
    const c = d.clinic, p = d.patient, t = d.totals;
    const [first, ...rest] = String(c.clinic_name || "").split(" ");
    const sub = [rest.join(" "), c.branch].filter(Boolean).join(" · ");
    const contact = [c.address && esc(c.address).replace(/\n/g, "<br>"), c.po_box && esc(c.po_box),
        [c.phone, c.alt_phone].filter(Boolean).length && "Tel: " + [c.phone, c.alt_phone].filter(Boolean).map(esc).join(" / "), c.email && esc(c.email),
        c.website && esc(c.website), c.licence_no && `<b>Reg. No.</b> ${esc(c.licence_no)}`].filter(Boolean).join("<br>");
    document.title = `Receipt ${d.receipt_no}`;
    document.getElementById("sheet-wrap").innerHTML = `
    <article class="sheet receipt">
        <header class="rh">
            <div class="rh__brand"><img src="/assets/clinic/images/northlake-mark.svg" alt=""><div class="rh__name"><b>${esc(first)}</b><span>${esc(sub)}</span><i></i></div></div>
            <div class="rh__contact">${contact}</div>
        </header>
        <div class="rule"></div>
        <div class="rcpt-title"><div><h1>Receipt</h1><div class="rcpt-no">No. ${esc(d.receipt_no)}</div></div><div class="paid-stamp">${d.waived ? "FEES WAIVED" : "PAID"}</div></div>
        <section class="meta" style="grid-template-columns:1fr 1fr;margin-bottom:10px">
            <dl><dt>Patient</dt><dd class="big">${esc(p.full_name)}</dd><dt>Patient No.</dt><dd>${esc(p.name)}</dd>${d.employer ? `<dt>Employer</dt><dd>${esc(d.employer)}${p.staff_no ? " · " + esc(p.staff_no) : ""}</dd>` : ""}</dl>
            <dl><dt>Date</dt><dd>${esc(dt(d.paid_on))}</dd><dt>Visit</dt><dd>${esc(d.visit)}</dd><dt>${d.waived ? "Settled by" : "Paid by"}</dt><dd>${esc(d.payment_mode || "—")}${d.payment_reference ? " · " + esc(d.payment_reference) : ""}</dd></dl>
        </section>
        <table class="tbl"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
            ${d.lines.map((l) => `<tr><td>${esc(l.description)} ${l.item_type === "Consultation" ? "" : `<span class="note" style="margin:0">${esc(l.item_type)}</span>`}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join("")}
        </tbody></table>
        <table class="totals">
            <tr class="grand"><td>Total</td><td class="r" style="text-align:right">${money(t.total)}</td></tr>
            ${d.waived ? `<tr><td>Fees waived</td><td style="text-align:right">${money(d.waived_amount)}</td></tr><tr><td>Balance due</td><td style="text-align:right">${money(0)}</td></tr>` : `<tr><td>Amount received</td><td style="text-align:right">${money(t.paid)}</td></tr>`}
            ${t.change ? `<tr><td>Change</td><td style="text-align:right">${money(t.change)}</td></tr>` : ""}
        </table>
        ${d.waived ? `<div class="note" style="margin-top:14px"><b>Fees waived</b> (${esc(money(d.waived_amount))}). Reason: ${esc(d.waiver_reason || "—")}. Authorised by the Clinic Manager${d.waived_by ? ", " + esc(d.waived_by) : ""}.</div>` : ""}
        <div class="note" style="margin-top:14px">Served by ${esc(d.received_by || "—")}. Thank you. Please keep this receipt as proof of payment.</div>
        <footer class="foot" style="position:static;margin-top:18px"><div class="row"><span>${esc(c.clinic_name || "")}${c.branch ? " · " + esc(c.branch) : ""}</span><span>Printed ${esc(dt(d.printed_on))}</span></div></footer>
    </article>`;
    msg.style.display = "none";
    btn.disabled = false;
    btn.addEventListener("click", () => window.print());
})();
