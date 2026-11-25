"""pH on the urinalysis, and the ANC Profile's urine rows grouped under one expandable "Urinalysis" heading.

Safe to run again: each step only acts when something is still missing.
"""

import frappe

from clinic.seed_data import LAB_TEST_TYPES

GROUP = "Urinalysis"
URINE = next(t for t in LAB_TEST_TYPES if t["test_name"] == "Urinalysis")["parameters"]
URINE_NAMES = {p["parameter"] for p in URINE}
PH = next(p for p in URINE if p["parameter"] == "pH")
KEEP_FIELDS = ("parameter", "result_type", "unit", "options", "normal_low", "normal_high", "param_group")
OPEN = ["Requested", "Sample Collected"]


def ph_position(names):
	"""Where pH goes in a list of parameter names: after Appearance, else before Specific Gravity, else last."""
	if "Appearance" in names:
		return names.index("Appearance") + 1
	if "Specific Gravity" in names:
		return names.index("Specific Gravity")
	return len(names)


def fix_type(test_type, grouped):
	if not frappe.db.exists("Clinic Lab Test Type", test_type):
		return
	doc = frappe.get_doc("Clinic Lab Test Type", test_type)
	rows = [{k: p.get(k) for k in KEEP_FIELDS} for p in doc.parameters]
	if not any((r["parameter"] or "").lower() == "ph" for r in rows):
		rows.insert(ph_position([r["parameter"] for r in rows]), {k: PH.get(k) for k in KEEP_FIELDS})
	if grouped:
		for r in rows:
			if r["parameter"] in URINE_NAMES:
				r["param_group"] = GROUP
	if [(p.parameter, p.param_group or "") for p in doc.parameters] == [(r["parameter"], r.get("param_group") or "") for r in rows]:
		return
	doc.set("parameters", [])
	for r in rows:
		doc.append("parameters", r)
	doc.save(ignore_permissions=True)


def add_ph_to_open_tests(test_type):
	"""A test raised before this update has no pH row yet; add it so the lab does not miss it."""
	for name in frappe.get_all("Clinic Lab Test", filters={"test_type": test_type, "status": ["in", OPEN]}, pluck="name"):
		doc = frappe.get_doc("Clinic Lab Test", name)
		if any((r.parameter or "").lower() == "ph" for r in doc.results):
			continue
		row = doc.append("results", {**{k: PH.get(k) for k in KEEP_FIELDS if k != "param_group"},
			"param_group": GROUP if test_type == "ANC Profile" else None})
		doc.results.remove(row)
		doc.results.insert(ph_position([r.parameter for r in doc.results]), row)
		for i, r in enumerate(doc.results, 1):
			r.idx = i
		doc.save(ignore_permissions=True)


def execute():
	frappe.reload_doc("clinic", "doctype", "clinic_lab_test_type_parameter")
	frappe.reload_doc("clinic", "doctype", "clinic_lab_test_result_item")
	fix_type("Urinalysis", grouped=False)
	fix_type("ANC Profile", grouped=True)
	# ANC tests already on file: tag their urine rows so they display grouped too
	frappe.db.sql(
		"""UPDATE `tabClinic Lab Test Result Item` r
		JOIN `tabClinic Lab Test` t ON t.name = r.parent AND r.parenttype = 'Clinic Lab Test'
		SET r.param_group = %s
		WHERE t.test_type = 'ANC Profile' AND IFNULL(r.param_group, '') = '' AND r.parameter IN %s""",
		(GROUP, tuple(URINE_NAMES)),
	)
	add_ph_to_open_tests("Urinalysis")
	add_ph_to_open_tests("ANC Profile")
