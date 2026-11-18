import frappe


def execute():
	"""Point the pharmacy at the Clinic Store warehouse once it exists, so dispensing reduces stock."""
	if frappe.db.get_single_value("Clinic Settings", "store_warehouse"):
		return
	name = frappe.db.get_value("Warehouse", {"warehouse_name": "Clinic Store"}, "name")
	if name:
		frappe.db.set_single_value("Clinic Settings", "store_warehouse", name)
