/* Management tab: the weekly duty rota. Generate a week, adjust any cell by clicking it, publish and print. */
(async function () {
    const { call, $, $$, esc, toast, modal } = Desk;
    await Desk.shell({
        page: "management",
        eyebrow: "Northlake Medical Centre · Management",
        title: "Management",
        sub: "Duty rota and Clinic Store stock",
        tools: "",
    });

    const CODES = ["M", "A", "O", "x"];
    const NAMES = { M: "Morning shift (till evening)", A: "Afternoon shift (till evening)", O: "Off day", x: "Not on duty" };
    let week = new URLSearchParams(location.search).get("week") || "";
    let st = null, dirty = false, rangeChoice = "1";

    const shift = (iso, days) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const nice = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

    async function load(w) {
        st = await call("management.rota_state", { week_start: w || week || undefined });
        week = st.week_start; dirty = false;
        render();
    }

    // the same rules the generator keeps, checked live as cells are changed
    function problems() {
        const out = [], rows = st.rota.rows, count = (a, c) => a.filter((x) => x === c).length;
        rows.forEach((r) => {
            const wk = r.days.slice(0, 5);
            if (count(wk, "A") !== 1) out.push(`${r.staff_name} has ${count(wk, "A")} afternoon shifts Mon to Fri (should be one)`);
            if (count(wk, "O") !== 1) out.push(`${r.staff_name} has ${count(wk, "O")} off days Mon to Fri (should be one)`);
            if (r.days[5] !== r.days[6]) out.push(`${r.staff_name} works only one day of the weekend`);
        });
        [[5, "Saturday"], [6, "Sunday"]].forEach(([d, l]) => { const n = rows.filter((r) => r.days[d] === "M").length; if (n !== 2) out.push(`${l} has ${n} on the morning shift (should be 2)`); });
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].forEach((l, d) => {
            if (!rows.some((r) => r.days[d] === "M")) out.push(`Nobody on the morning shift on ${l}`);
            if (!rows.some((r) => r.days[d] === "A")) out.push(`Nobody on the afternoon shift on ${l}`);
        });
        return out;
    }

    function render() {
        const r = st.rota;
        if (r) st.problems = problems();
        const nav = `<div class="card" style="padding:14px 22px;margin-bottom:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <button class="btn btn--sm" id="prev">&larr; Previous week</button>
            <div style="font-weight:600;min-width:260px;text-align:center">${esc(st.label)} &middot; ${esc(nice(st.week_start))} to ${esc(nice(st.week_end))}</div>
            <button class="btn btn--sm" id="next">Next week &rarr;</button>
            <span style="margin-left:auto;display:flex;align-items:center;gap:8px"><label class="meta" for="range">Range</label>
                <select id="range"><option value="1">This week only</option><option value="2">2 weeks</option><option value="4">4 weeks</option><option value="month">Rest of this month</option><option value="13">3 months</option></select>
                <button class="btn btn--sm btn--primary" id="genrange">Generate range</button>
                <button class="btn btn--sm" id="printrange">Print range</button></span>
            <span class="meta">${r ? (r.status === "Published" ? '<span class="pill good">Published</span>' : '<span class="pill warn">Draft</span>') : '<span class="pill mute">No rota yet</span>'}</span>
        </div>`;
        if (!r) {
            $("#rp").innerHTML = nav + `<div class="card" style="padding:34px;text-align:center">
                <p style="margin:0 0 14px;color:var(--ink-3)">There is no rota for this week. It will be worked out from the rules: one afternoon shift and one off day each, two people on the morning shift on Saturday and Sunday, and ${esc(st.proposed_on_call || "someone")} on call.</p>
                <button class="btn btn--primary" id="gen">Generate this week's rota</button></div>${recent()}`;
            $("#gen").addEventListener("click", () => generate(0));
        } else {
            $("#rp").innerHTML = nav + `<div class="card" style="padding:18px 22px;margin-bottom:18px">
                <div class="tscroll"><table class="table rota"><thead><tr><th>Name</th>${st.days.map((d) => `<th class="c ${d.label === "Sat" || d.label === "Sun" ? "wk" : ""}">${d.label}<small>${esc(nice(d.date))}</small></th>`).join("")}</tr></thead><tbody>
                ${r.rows.map((row, i) => `<tr><td><b>${esc(row.staff_name)}</b></td>${row.days.map((c, j) => `<td class="c"><button type="button" class="rcell rc-${c || "e"}" data-i="${i}" data-j="${j}" title="${esc(NAMES[c] || "")}">${esc(c || "·")}</button></td>`).join("")}</tr>`).join("")}
                </tbody></table></div>
                <div class="rota__foot">
                    <div><b>On call this week:</b> <select id="oncall">${r.rows.map((x) => `<option ${x.staff_name === r.on_call ? "selected" : ""}>${esc(x.staff_name)}</option>`).join("")}</select></div>
                    <div class="meta"><span class="rcell rc-M sm">M</span> Morning (till evening) &nbsp; <span class="rcell rc-A sm">A</span> Afternoon (till evening) &nbsp; <span class="rcell rc-O sm">O</span> Off &nbsp; <span class="rcell rc-x sm">x</span> Not on duty. Click a cell to change it.</div>
                </div>
                ${st.problems.length ? `<div class="liveinfo" style="background:var(--warn-bg);color:var(--warn);margin-top:12px"><b>Check:</b> ${st.problems.map(esc).join(" &middot; ")}</div>` : ""}
                <div class="field" style="margin-top:12px"><label>Notes</label><input type="text" id="notes" value="${esc(r.notes || "")}" placeholder="e.g. leave or a swap agreed"></div>
                <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap">
                    <button class="btn" id="regen">Regenerate</button>
                    <button class="btn" id="save">Save changes</button>
                    <button class="btn btn--primary" id="pub">${r.status === "Published" ? "Save &amp; keep published" : "Publish"}</button>
                    <button class="btn btn--signal" id="print">Print / Download</button>
                </div></div>${recent()}`;
            $$(".rcell[data-i]").forEach((b) => b.addEventListener("click", () => {
                const row = st.rota.rows[b.dataset.i], j = Number(b.dataset.j);
                row.days[j] = CODES[(CODES.indexOf(row.days[j]) + 1) % CODES.length];
                dirty = true; render();
            }));
            $("#oncall").addEventListener("change", (e) => { st.rota.on_call = e.target.value; dirty = true; });
            $("#regen").addEventListener("click", () => generate(1));
            $("#save").addEventListener("click", () => save("Draft"));
            $("#pub").addEventListener("click", () => save("Published"));
            $("#print").addEventListener("click", async () => { if (dirty) await save(st.rota.status, true); window.open(`/clinic/rotadoc?week=${st.week_start}`, "_blank"); });
        }
        const rng = $("#range"); rng.value = rangeChoice; rng.addEventListener("change", () => { rangeChoice = rng.value; });
        $("#genrange").addEventListener("click", () => generateRange());
        $("#printrange").addEventListener("click", () => window.open(`/clinic/rotadoc?week=${st.week_start}&weeks=${weeksIn()}`, "_blank"));
        $("#prev").addEventListener("click", () => go(-7));
        $("#next").addEventListener("click", () => go(7));
        $$("[data-wk]").forEach((a) => a.addEventListener("click", () => go(0, a.dataset.wk)));
    }

    function recent() {
        if (!st.recent.length) return "";
        return `<div class="card"><div class="card__head"><h3>Recent rotas</h3></div><div class="tscroll"><table class="table"><tbody>
            ${st.recent.map((x) => `<tr><td><a href="#" data-wk="${esc(x.week_start)}">${esc(nice(x.week_start))}</a></td><td>${esc(x.week_label || "")}</td><td>On call: ${esc(x.on_call || "")}</td><td>${esc(x.status)}</td></tr>`).join("")}
        </tbody></table></div></div>`;
    }

    async function go(days, to) {
        if (dirty && !confirm("You have unsaved changes to this rota. Leave without saving?")) return;
        await load(to || shift(week, days));
    }
    // number of weeks the chosen range covers, counted from the week on screen
    function weeksIn() {
        if (rangeChoice !== "month") return Number(rangeChoice);
        const m = new Date(st.week_start + "T00:00:00").getMonth();
        let n = 0, d = new Date(st.week_start + "T00:00:00");
        while (d.getMonth() === m) { n++; d.setDate(d.getDate() + 7); }
        return Math.max(n, 1);
    }
    async function generateRange() {
        const weeks = weeksIn();
        if (weeks === 1) return st.rota ? toast("This week already has a rota. Use Regenerate to replace it.", "warn") : generate(0);
        if (dirty && !confirm("You have unsaved changes to this rota. Generate without saving?")) return;
        try {
            st = await call("management.generate_rota", { week_start: week, weeks });
            const r = st.range_result; dirty = false; render();
            toast(`${r.created} week${r.created === 1 ? "" : "s"} generated${r.skipped ? `, ${r.skipped} already had a rota and were kept` : ""}`);
        } catch (e) { /* shown by call() */ }
    }
    async function generate(replace) {
        if (replace && !confirm("Replace this week's rota with a freshly generated one? Hand edits will be lost.")) return;
        try { st = await call("management.generate_rota", { week_start: week, replace }); week = st.week_start; dirty = false; render(); toast("Rota generated"); } catch (e) { /* shown by call() */ }
    }
    async function save(status, quiet) {
        try {
            st = await call("management.save_rota", { week_start: week, rows: JSON.stringify(st.rota.rows), on_call: st.rota.on_call, status, notes: $("#notes") ? $("#notes").value : st.rota.notes });
            dirty = false; render(); if (!quiet) toast(status === "Published" ? "Rota published" : "Rota saved");
        } catch (e) { /* shown by call() */ }
    }

    const style = document.createElement("style");
    style.textContent = `.rota th.c,.rota td.c{text-align:center}.rota th small{display:block;font-weight:400;color:var(--ink-mute)}.rota th.wk{background:rgba(185,119,14,.08)}
    .rcell{border:1.5px solid var(--hairline,#ddd);background:#fff;border-radius:10px;width:42px;height:38px;font:600 15px var(--font,inherit);cursor:pointer}
    .rcell.sm{display:inline-grid;place-items:center;width:24px;height:22px;font-size:12px;border-radius:6px;cursor:default;vertical-align:middle}
    .rc-M{background:#e8f3ec;color:#1a6b3a;border-color:#bfe0cb}.rc-A{background:#fff1d9;color:#9a5b00;border-color:#f0d49a}.rc-O{background:#fde7e6;color:#c4302b;border-color:#f4b9b6}.rc-x{background:#f1f1ee;color:#999;border-color:#e2e2dc}.rc-e{color:#bbb}
    .rota__foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:14px}`;
    document.head.appendChild(style);
    Desk.tabs((tab) => { if (tab === "stock" && window.ReceiveStock) window.ReceiveStock.open(); });
    await load();
})();
