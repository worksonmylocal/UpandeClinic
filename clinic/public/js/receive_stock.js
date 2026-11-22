/* Management > Receive Stock: book a delivery into the Clinic Store, see balances, and the latest deliveries. */
(function () {
    const { call, $, $$, esc, toast, suggest, empty } = Desk;
    let state = null, lines = [], filter = "all", loaded = false, busy = false;

    const n = (v) => Number(v || 0).toLocaleString();
    const dt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

    async function open() {
        if (loaded) return;
        loaded = true;
        try { state = await call("management.stock_state"); } catch (e) { loaded = false; return; }
        render();
    }

    const byName = () => Object.fromEntries(state.items.map((i) => [i.name, i]));

    function render() {
        const root = $("#stock");
        if (!state.warehouse) {
            root.innerHTML = `<div class="card"><p style="margin:0;color:var(--ink-3)">The Clinic Store is not set up yet. Choose it under <b>Store Warehouse</b> in Clinic Settings, then come back here.</p></div>`;
            return;
        }
        root.innerHTML = `
        <div class="card" style="margin-bottom:18px">
            <div class="card__head"><h3>Receive stock</h3><span class="meta">Delivered to ${esc(state.warehouse)}</span></div>
            <div class="field"><label>Add a medicine</label><input class="input" id="rs-add" placeholder="Search the medicine list, or type a new name to add it"></div>
            <div id="rs-lines" style="margin-top:12px"></div>
            <div class="grid-2" style="margin-top:12px">
                <div class="field"><label>Supplier / delivery note (optional)</label><input class="input" id="rs-ref" placeholder="e.g. Delivery note 4471, Kenya Medical Supplies"></div>
                <div style="display:flex;align-items:flex-end;justify-content:flex-end;gap:10px"><button class="btn" id="rs-clear">Clear</button><button class="btn btn--primary" id="rs-go">Receive stock</button></div>
            </div>
        </div>
        <div class="card" style="margin-bottom:18px">
            <div class="card__head"><h3>Store balances</h3><span class="meta" id="rs-count"></span></div>
            <div class="filterbar"><input class="input" id="rs-q" placeholder="Search medicines…"><div class="chipbox" id="rs-chips"></div></div>
            <div id="rs-table"></div>
        </div>
        <div class="card"><div class="card__head"><h3>Recent deliveries</h3></div><div id="rs-recent"></div></div>`;

        suggest($("#rs-add"), {
            fetch: (q) => state.items.filter((i) => !q || i.item_name.toLowerCase().includes(q.toLowerCase())).slice(0, 15),
            render: (i) => ({ main: i.item_name, sub: i.stock_uom, tag: Desk.stockText(i.stock), tagCls: Desk.stockCls(i.stock) }),
            onPick: (i) => { $("#rs-add").value = ""; addLine(i); },
            allowNew: async (name) => {
                const item = await call("management.add_medicine", { drug_name: name });
                if (!state.items.some((x) => x.name === item.name)) state.items.push(item);
                toast(`${item.item_name} added to the medicine list`);
                renderTable();
                return item;
            },
        });
        $("#rs-go").addEventListener("click", submit);
        $("#rs-clear").addEventListener("click", () => { lines = []; $("#rs-ref").value = ""; renderLines(); });
        $("#rs-q").addEventListener("input", renderTable);
        renderChips(); renderLines(); renderTable(); renderRecent();
    }

    function addLine(item) {
        const have = lines.find((l) => l.item === item.name);
        if (have) { const q = $(`[data-q="${CSS.escape(item.name)}"]`); if (q) q.focus(); return toast(`${item.item_name} is already in the list`, "warn"); }
        lines.push({ item: item.name, qty: "" });
        renderLines();
        const q = $(`[data-q="${CSS.escape(item.name)}"]`); if (q) q.focus();
    }

    function renderLines() {
        const el = $("#rs-lines"), items = byName();
        el.innerHTML = lines.length ? `<table class="dtable"><tr><th>Medicine</th><th class="num">In store now</th><th style="width:140px">Quantity received</th><th class="num">New balance</th><th></th></tr>
            ${lines.map((l, i) => { const it = items[l.item] || {}; return `<tr><td><b style="color:var(--ink)">${esc(it.item_name || l.item)}</b> <span class="printnote">${esc(it.stock_uom || "")}</span></td>
                <td class="num">${n(it.stock)}</td>
                <td><input class="input" type="number" min="0" step="any" data-q="${esc(l.item)}" value="${esc(l.qty)}" placeholder="0"></td>
                <td class="num" data-nb="${i}">${Number(l.qty) > 0 ? n(Number(it.stock || 0) + Number(l.qty)) : "—"}</td>
                <td><button class="iconx" data-del="${i}" title="Remove">×</button></td></tr>`; }).join("")}</table>`
            : empty("No medicines added yet. Search above and add each medicine that was delivered.");
        $$("[data-q]", el).forEach((inp) => inp.addEventListener("input", () => {
            const i = lines.findIndex((l) => l.item === inp.dataset.q); lines[i].qty = inp.value;
            const nb = $(`[data-nb="${i}"]`), it = items[lines[i].item] || {};
            if (nb) nb.textContent = Number(inp.value) > 0 ? n(Number(it.stock || 0) + Number(inp.value)) : "—";
        }));
        $$("[data-del]", el).forEach((b) => b.addEventListener("click", () => { lines.splice(Number(b.dataset.del), 1); renderLines(); }));
    }

    function renderChips() {
        const opts = [["all", "All"], ["low", "Low (under 10)"], ["out", "Out of stock"]];
        $("#rs-chips").innerHTML = opts.map(([k, l]) => `<button class="chipsel ${filter === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("");
        $$("#rs-chips [data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; renderChips(); renderTable(); }));
    }

    function renderTable() {
        const q = (($("#rs-q") || {}).value || "").toLowerCase();
        const rows = state.items.filter((i) => (!q || i.item_name.toLowerCase().includes(q)) && (filter === "all" || (filter === "out" ? i.stock <= 0 : i.stock > 0 && i.stock < 10)));
        const out = state.items.filter((i) => i.stock <= 0).length;
        $("#rs-count").textContent = `${state.items.length} medicines · ${out} out of stock`;
        $("#rs-table").innerHTML = rows.length ? `<div class="tscroll"><table class="dtable"><tr><th>Medicine</th><th>Unit</th><th class="num">In store</th><th></th></tr>
            ${rows.map((i) => `<tr><td><b style="color:var(--ink)">${esc(i.item_name)}</b></td><td>${esc(i.stock_uom)}</td><td class="num">${n(i.stock)}</td>
                <td class="num"><span class="stk ${Desk.stockCls(i.stock)}">${Desk.stockText(i.stock)}</span> <button class="btn btn--sm" data-recv="${esc(i.name)}">Receive</button></td></tr>`).join("")}</table></div>` : empty("No medicines match.");
        $$("[data-recv]", $("#rs-table")).forEach((b) => b.addEventListener("click", () => { const it = byName()[b.dataset.recv]; addLine(it); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    }

    function renderRecent() {
        $("#rs-recent").innerHTML = state.recent.length ? `<div class="tscroll"><table class="dtable"><tr><th>Date</th><th>Entry</th><th>Received</th><th>By</th></tr>
            ${state.recent.map((r) => `<tr><td>${esc(dt(r.date))}</td><td>${esc(r.name)}</td>
                <td>${r.lines.map((l) => `${esc(l.item)} <b>×${n(l.qty)}</b>`).join(", ")}${r.remarks ? `<div class="printnote">${esc(r.remarks)}</div>` : ""}</td><td>${esc(r.by)}</td></tr>`).join("")}</table></div>`
            : empty("No deliveries recorded yet.");
    }

    async function submit() {
        if (busy) return;
        const send = lines.filter((l) => Number(l.qty) > 0);
        if (!send.length) return toast("Enter the quantity received for at least one medicine", "warn");
        busy = true; $("#rs-go").disabled = true;
        try {
            const r = await call("management.receive_stock", { items: JSON.stringify(send), reference: $("#rs-ref").value });
            state = r.state; lines = [];
            render();
            toast(`Stock received: ${r.lines} medicine${r.lines === 1 ? "" : "s"} added to the Clinic Store (${r.name})`);
            Desk.stockCache && Object.keys(Desk.stockCache).forEach((k) => delete Desk.stockCache[k]);
        } catch (e) { /* shown by call() */ }
        finally { busy = false; const b = $("#rs-go"); if (b) b.disabled = false; }
    }

    window.ReceiveStock = { open };
})();
