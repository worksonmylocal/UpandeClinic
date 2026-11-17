"""Urinalysis gets the lab's own parameter list; the Salmonella agglutination test becomes the Salmonella Antigen Test."""

import frappe

from clinic.seed_data import LAB_TEST_TYPES

OLD, NEW = "SAT (Salmonella Agglutination Test)", "Salmonella Antigen Test"


def execute():
	if frappe.db.exists("Clinic Lab Test Type", OLD) and not frappe.db.exists("Clinic Lab Test Type", NEW):
		frappe.rename_doc("Clinic Lab Test Type", OLD, NEW, force=True)
	for row in frappe.get_all("Clinic Lab Price", filters={"test_type": OLD}, pluck="name"):
		frappe.db.set_value("Clinic Lab Price", row, "test_type", NEW)
	wanted = next(t for t in LAB_TEST_TYPES if t["test_name"] == "Urinalysis")
	if frappe.db.exists("Clinic Lab Test Type", "Urinalysis"):
		doc = frappe.get_doc("Clinic Lab Test Type", "Urinalysis")
		doc.set("parameters", [])
		for p in wanted["parameters"]:
			doc.append("parameters", p)
		doc.save(ignore_permissions=True)
