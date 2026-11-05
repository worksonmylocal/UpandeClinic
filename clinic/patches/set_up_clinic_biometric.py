import frappe

from clinic import attendance


def execute():
	"""Label the clinic biometric device's punches. Leaves a device that is already set alone."""
	attendance.ensure_custom_field()
	if not frappe.db.get_single_value("Clinic Settings", "biometric_device_id"):
		device = attendance.find_device()
		if device:
			frappe.db.set_single_value("Clinic Settings", "biometric_device_id", device)
	attendance.relabel()
