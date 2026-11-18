"""The ANC Profile's urine parameters become the lab's own urinalysis list (the same one the Urinalysis test uses)."""

import frappe

from clinic.seed_data import LAB_TEST_TYPES

OLD_URINE = ("Urine Protein", "Urine Glucose")
KEEP_FIELDS = ("parameter", "result_type", "unit", "options", "normal_low", "normal_high")


def execute():
	if not frappe.db.exists("Clinic Lab Test Type", "ANC Profile"):
		return
	urinalysis = next(t for t in LAB_TEST_TYPES if t["test_name"] == "Urinalysis")["parameters"]
	urine_names = {u["parameter"] for u in urinalysis}
	doc = frappe.get_doc("Clinic Lab Test Type", "ANC Profile")
	# the blood tests stay as they are, in order; the urine rows are replaced by the urinalysis list
	blood = [{k: p.get(k) for k in KEEP_FIELDS} for p in doc.parameters if p.parameter not in OLD_URINE and p.parameter not in urine_names]
	wanted = blood + [dict(u) for u in urinalysis]
	if [p.parameter for p in doc.parameters] == [w["parameter"] for w in wanted]:
		return
	doc.set("parameters", [])
	for row in wanted:
		doc.append("parameters", row)
	doc.instructions = "Antenatal profile: Hb, blood group, VDRL, blood sugar and a full urinalysis."
	doc.save(ignore_permissions=True)
