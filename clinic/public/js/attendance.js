/* Clinic attendance: the clinic biometric device's check-ins and check-outs */
(async function () {
    const { call, $, $$, esc, num, timeOf, dateOf, initials, pill, empty, toast, kpis } = Desk;

    await Desk.shell({
        page: "attendance",
        eyebrow: "Mutara Clinic · Biometric",
        title: "Attendance",
        sub: "Who came to the clinic, and when they checked in and out on the clinic biometric device",
        tools: `<button class="iconbtn" id="refresh" title="Refresh">${Desk.REFRESH_ICON}</button>`,
    });
    Desk.tabs();
    $("#refresh").addEventListener("click", () => { load(); toast("Refreshed"); });

    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const today = new Date();
    $("#f-from").value = $("#f-to").value = iso(today);
    const quick = {
        today: () => [today, today],
        yesterday: () => { const y = new Date(today); y.setDate(y.getDate() - 1); return [y, y]; },
        week: () => { const s = new Date(today); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return [s, today]; },
        month: () => [new Date(today.getFullYear(), today.getMonth(), 1), today],
    };
    $$("[data-q]").forEach((b) => b.addEventListener("click", () => { const [a, z] = quick[b.dataset.q](); $("#f-from").value = iso(a); $("#f-to").value = iso(z); load(); }));
    ["#f-from", "#f-to"].forEach((s) => $(s).addEventListener("change", load));
    let t; $("#f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 300); });

    const clock = (v) => (v ? esc(timeOf(v)) : "—");
    const dur = (m) => (m == null ? "—" : Desk.duration(m));
    const STATUS = { "In clinic": "info", Completed: "good", "No check-out": "warn", "No check-in": "warn" };
    const person = (s) => `<div class="emp">${s.image ? `<img class="emp__av" src="${esc(s.image)}" alt="">` : `<div class="emp__av">${esc(initials(s.employee_name))}</div>`}
        <div><b>${esc(s.employee_name)}</b><small>${esc(s.employee)}${s.department ? " · " + esc(s.department) : ""}${s.designation ? " · " + esc(s.designation) : ""}</small></div></div>`;
    let d;

    async function load() {
        d = await call("attendance.dashboard", { from_date: $("#f-from").value, to_date: $("#f-to").value, q: $("#f-q").value });
        if (!d.configured) {
            $("#kpis").innerHTML = "";
            $("#visits").innerHTML = $("#punches").innerHTML = empty(d.reason);
            return;
        }
        const k = d.kpis, one = d.range.from === d.range.to;
        kpis($("#kpis"), [
            { label: "In the Clinic Now", value: k.in_now, cls: k.in_now ? "info" : "", unit: "Checked in, not out yet today" },
            { label: one ? "Visits" : "Visits in Range", value: k.visits, cls: "good", unit: `${k.people} employee${k.people === 1 ? "" : "s"}` },
            { label: "Average Time in Clinic", value: Desk.duration(k.avg_minutes), unit: "Completed visits" },
            { label: "Missing Check-out", value: k.no_checkout, cls: k.no_checkout ? "warn" : "", unit: "Earlier days, no check-out recorded" },
        ]);
        $("#visits-meta").textContent = one ? Desk.dateOf(d.range.from) : `${d.range.from} → ${d.range.to}`;
        $("#visits").innerHTML = d.sessions.length ? `<table class="dtable"><tr><th>Employee</th><th>Date</th><th>Time in</th><th>Time out</th><th class="num">Time in clinic</th><th>Status</th></tr>
            ${d.sessions.map((s) => `<tr><td>${person(s)}</td><td>${esc(s.date.slice(5))}</td><td><b style="color:var(--ink)">${clock(s.time_in)}</b></td><td><b style="color:var(--ink)">${clock(s.time_out)}</b></td>
                <td class="num">${dur(s.minutes)}</td><td>${pill(s.status, STATUS[s.status] || "mute")}</td></tr>`).join("")}</table>` : empty("No clinic check-ins in this range.");
        $("#punches-meta").textContent = `${d.punches.length} punch${d.punches.length === 1 ? "" : "es"}`;
        $("#punches").innerHTML = d.punches.length ? `<table class="dtable"><tr><th>Employee</th><th>Date</th><th>Time</th><th>Punch</th><th>Device</th></tr>
            ${d.punches.map((p) => `<tr><td>${person(p)}</td><td>${esc(dateOf(p.time).slice(5))}</td><td><b style="color:var(--ink)">${clock(p.time)}</b></td>
                <td>${pill(p.label, p.log_type === "IN" ? "good" : "mute")}</td><td class="printnote">${esc(p.device_id)}</td></tr>`).join("")}</table>` : empty("No punches in this range.");
    }

    await load();
    Desk.poll(load, 30000);
})();
