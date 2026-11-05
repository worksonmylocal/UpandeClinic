"""The clinic's biometric device: its punches on Employee Checkin become Clinic Check-in / Clinic Check-out
and are kept out of HR's automatic attendance (the device is for the clinic alone).

The device is named in Clinic Settings (Clinic Biometric Device ID). Employee Checkin comes from HRMS, so every function
here does nothing on a site without it. Nothing on the checkin itself is changed except one extra label field.
"""

import frappe

FIELD = "custom_clinic_log"
IN_LABEL, OUT_LABEL = "Clinic Check-in", "Clinic Check-out"


def device_ids():
	raw = frappe.db.get_single_value("Clinic Settings", "biometric_device_id") or ""
	return [d.strip() for d in raw.replace(",", "\n").splitlines() if d.strip()]


def has_checkin():
	return frappe.db.table_exists("Employee Checkin")


def label_for(log_type):
	return IN_LABEL if log_type == "IN" else OUT_LABEL


def label_checkin(doc, method=None):
	"""doc_events hook: label punches from the clinic device as they come in.

	The clinic device is for the clinic alone, so its punches are kept out of HR's automatic attendance."""
	if doc.get("device_id") and doc.device_id in device_ids():
		doc.set(FIELD, label_for(doc.log_type))
		if not doc.get("attendance"):
			doc.skip_auto_attendance = 1
	elif doc.get(FIELD):
		doc.set(FIELD, None)


def ensure_custom_field():
	"""The read-only Clinic Log field on Employee Checkin (after_migrate: safe to repeat)."""
	if not has_checkin():
		return
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"Employee Checkin": [
				{
					"fieldname": FIELD,
					"label": "Clinic Log",
					"fieldtype": "Data",
					"read_only": 1,
					"in_standard_filter": 1,
					"in_list_view": 1,
					"insert_after": "log_type",
					"no_copy": 1,
				}
			]
		},
		update=True,
	)


def relabel():
	"""Label every punch from the clinic device, and clear the label from any other device's punches."""
	if not has_checkin() or not frappe.db.has_column("Employee Checkin", FIELD):
		return 0
	devices = device_ids()
	frappe.db.sql(f"UPDATE `tabEmployee Checkin` SET `{FIELD}` = NULL WHERE `{FIELD}` IS NOT NULL AND `{FIELD}` != ''" + (
		" AND device_id NOT IN %(d)s" if devices else ""), {"d": tuple(devices)})
	if not devices:
		return 0
	frappe.db.sql(
		f"""UPDATE `tabEmployee Checkin` SET `{FIELD}` = IF(log_type = 'IN', %(i)s, %(o)s)
		WHERE device_id IN %(d)s AND IFNULL(`{FIELD}`, '') = ''""",
		{"i": IN_LABEL, "o": OUT_LABEL, "d": tuple(devices)},
	)
	# Keep these punches out of HR's automatic attendance. Punches already turned into an Attendance record are left
	# alone: those records belong to HR.
	if frappe.db.has_column("Employee Checkin", "skip_auto_attendance"):
		frappe.db.sql(
			"""UPDATE `tabEmployee Checkin` SET skip_auto_attendance = 1
			WHERE device_id IN %(d)s AND IFNULL(attendance, '') = '' AND IFNULL(skip_auto_attendance, 0) = 0""",
			{"d": tuple(devices)},
		)
	return len(devices)


def find_device():
	"""First-time setup: the device on this site whose serial starts 726 and ends 0985 (the clinic's)."""
	if not has_checkin():
		return None
	rows = frappe.db.sql(
		"SELECT DISTINCT device_id FROM `tabEmployee Checkin` WHERE device_id LIKE %s", ("%726%0985",), pluck=True
	)
	return rows[0] if len(rows) == 1 else None
