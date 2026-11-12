/* Patient files: search any patient and download their file */
(async function () {
    const { call, $, $$, esc, dateOf, typeTag, empty, modal } = Desk;
    await Desk.shell({
        page: "patientfiles",
        eyebrow: "Northlake Medical Centre · Records",
        title: "Patient Files",
        sub: "Find a patient and download their latest encounter or their entire file",
        tools: "",
    });

    const age = (dob) => { if (!dob) return ""; const y = Math.floor((Date.now() - new Date(dob)) / 31557600000); return y < 1 ? "<1 yr" : y + " yrs"; };
    let timer, seq = 0;
    let all = [];
    async function load(more) {
        const mine = ++seq;
        const start = more ? all.length : 0;
        const got = await call("patient_files.search", { q: $("#pf-q").value, patient_type: $("#pf-type").value || undefined, start });
        if (mine !== seq) return;
        const hasMore = got.length > 100;
        all = (more ? all : []).concat(got.slice(0, 100));
        const rows = all;
        $("#pf-meta").textContent = `${rows.length}${hasMore ? "+" : ""} patient${rows.length === 1 ? "" : "s"} (all dates)`;
        $("#pf-rows").innerHTML = rows.length ? `<table class="dtable"><tr><th>Patient</th><th>Type</th><th>ID / Phone</th><th>Last seen</th><th class="num">Encounters</th><th></th></tr>
            ${rows.map((r) => `<tr><td><b style="color:var(--ink)">${esc(r.full_name)}</b><br><span class="printnote">${esc(r.patient)} · ${esc([age(r.date_of_birth), r.sex].filter(Boolean).join(" · "))}</span></td>
            <td>${typeTag(r.patient_type)}${r.employer ? `<br><span class="printnote">${esc(r.employer)}</span>` : ""}</td>
            <td>${esc(r.national_id || r.staff_no || "—")}<br><span class="printnote">${esc(r.phone || "")}</span></td>
            <td>${r.last_seen ? esc(dateOf(r.last_seen)) : "—"}</td><td class="num">${r.encounters}</td>
            <td class="num">${r.latest ? `<button class="btn btn--sm btn--primary" data-file="${esc(r.latest)}" data-patient="${esc(r.full_name)}" data-when="${esc(dateOf(r.last_seen))}">Download file</button>` : '<span class="printnote">No consultations yet</span>'}</td></tr>`).join("")}</table>${hasMore ? '<div style="text-align:center;padding:14px"><button class="btn" id="pf-more">Show more</button></div>' : ""}` : empty("No patients match your search.");
        const mb = $("#pf-more"); if (mb) mb.addEventListener("click", () => load(true));
        $$("[data-file]", $("#pf-rows")).forEach((b) => b.addEventListener("click", () => choose(b.dataset.file, b.dataset.patient, b.dataset.when)));
    }

    function choose(consultation, patient, when) {
        const open = (scope) => window.open(`/clinic/patientfile?consultation=${encodeURIComponent(consultation)}&scope=${scope}`, "_blank");
        const choice = (scope, title, note) => `<button type="button" class="btn" data-scope="${scope}" style="display:block;width:100%;text-align:left;white-space:normal;line-height:1.45;padding:16px 18px;margin-bottom:12px;border-radius:16px"><b style="font-size:15px;color:var(--ink)">${title}</b><br><span class="printnote" style="font-weight:400">${note}</span></button>`;
        const m = modal({
            title: "Download file", sub: esc(patient),
            body: `${choice("encounter", "Latest encounter", `Only the most recent encounter (${esc(when)}): vitals, history, examination, diagnosis, results and treatment.`)}
                ${choice("full", "Entire file", "Every completed visit on record for this patient, newest first, with a summary of the visits at the front.")}
                <div class="printnote">The file opens in a new tab. Choose <b>Save as PDF</b> to download it. Each download is logged on the consultation.</div>`,
            foot: [{ label: "Cancel" }],
        });
        $$("[data-scope]", m.body).forEach((b) => b.addEventListener("click", () => { open(b.dataset.scope); m.close(); }));
    }

    $("#pf-q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); });
    $("#pf-type").addEventListener("change", () => load());
    load();
})();
