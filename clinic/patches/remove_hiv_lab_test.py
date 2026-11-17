"""HIV testing is done in the HTS clinic, not the lab: retire the lab's HIV test and take HIV out of the ANC profile."""

import frappe


def execute():
	for name in frappe.get_all("Clinic Lab Test Type", filters={"test_name": ["like", "HIV%"]}, pluck="name"):
		frappe.db.set_value("Clinic Lab Test Type", name, "enabled", 0)
	for name in frappe.get_all("Clinic Lab Test Type", filters={"test_name": "ANC Profile"}, pluck="name"):
		doc = frappe.get_doc("Clinic Lab Test Type", name)
		kept = [p for p in doc.parameters if "HIV" not in (p.parameter or "")]
		if len(kept) != len(doc.parameters):
			doc.set("parameters", kept)
			doc.instructions = (doc.instructions or "").replace(" HIV,", "").replace("HIV, ", "")
			doc.save(ignore_permissions=True)
