"""HBsAg (Negative / Positive) on the ANC Profile, straight after VDRL.

Safe to run again: it does nothing once HBsAg is on the test.
"""

import frappe

HBSAG = {"parameter": "HBsAg", "result_type": "Qualitative", "unit": "", "options": "Negative\nPositive"}
INSTRUCTIONS = "Antenatal profile: Hb, blood group, VDRL, HBsAg, blood sugar and a full urinalysis."
KEEP_FIELDS = ("parameter", "result_type", "unit", "options", "normal_low", "normal_high", "param_group")
OPEN = ["Requested", "Sample Collected"]


def has_hbsag(names):
	return any((n or "").lower() == "hbsag" for n in names)


def position(names):
	"""After VDRL; failing that, before Blood Sugar; failing that, last."""
	for after, offset in (("VDRL", 1), ("Blood Sugar", 0)):
		if after in names:
			return names.index(after) + offset
	return len(names)


def execute():
	if not frappe.db.exists("Clinic Lab Test Type", "ANC Profile"):
		return
	doc = frappe.get_doc("Clinic Lab Test Type", "ANC Profile")
	missing = not has_hbsag(p.parameter for p in doc.parameters)
	if missing or doc.instructions != INSTRUCTIONS:
		if missing:
			rows = [{k: p.get(k) for k in KEEP_FIELDS} for p in doc.parameters]
			rows.insert(position([r["parameter"] for r in rows]), dict(HBSAG))
			doc.set("parameters", [])
			for r in rows:
				doc.append("parameters", r)
		doc.instructions = INSTRUCTIONS
		doc.save(ignore_permissions=True)
	# a test raised before this update has no HBsAg row yet; add it so the lab does not miss it
	for name in frappe.get_all("Clinic Lab Test", filters={"test_type": "ANC Profile", "status": ["in", OPEN]}, pluck="name"):
		test = frappe.get_doc("Clinic Lab Test", name)
		if has_hbsag(r.parameter for r in test.results):
			continue
		row = test.append("results", dict(HBSAG))
		test.results.remove(row)
		test.results.insert(position([r.parameter for r in test.results]), row)
		for i, r in enumerate(test.results, 1):
			r.idx = i
		test.save(ignore_permissions=True)
