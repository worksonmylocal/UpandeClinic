import frappe


def execute():
	"""Deep Heat is sprayed on many patients from one can, so it is never charged to a patient."""
	frappe.reload_doc("clinic", "doctype", "clinic_unbilled_item")
	frappe.reload_doc("clinic", "doctype", "clinic_settings")
	settings = frappe.get_doc("Clinic Settings")
	have = {r.item for r in settings.get("unbilled_items") or []}
	for item in frappe.get_all("Item", filters={"item_name": ["like", "Deep Heat%"]}, pluck="name"):
		if item not in have:
			settings.append("unbilled_items", {"item": item})
	settings.save(ignore_permissions=True)
