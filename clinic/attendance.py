"""The clinic's biometric device: its punches on Employee Checkin become Clinic Check-in / Clinic Check-out
and are kept out of HR's automatic attendance (the device is for the clinic alone).

The device is named in Clinic Settings (Clinic Biometric Device ID). Employee Checkin comes from HRMS, so every function
here does nothing on a site without it. Nothing on the checkin itself is changed except one extra label field.
"""

import frappe
from frappe.utils import get_datetime

DUPLICATE_SECONDS = 120  # a device that re-sends a punch must not count twice
FIELD = "custom_clinic_log"
IN_LABEL, OUT_LABEL = "Clinic Check-in", "Clinic Check-out"


def device_ids():
	raw = frappe.db.get_single_value("Clinic Settings", "biometric_device_id") or ""
	return [d.strip() for d in raw.replace(",", "\n").splitlines() if d.strip()]


def has_checkin():
	return frappe.db.table_exists("Employee Checkin")


def label_for(log_type):
	return IN_LABEL if log_type == "IN" else OUT_LABEL


def sequence(times):
	"""The device's own In/Out setting is ignored: for each person each day, the 1st touch is time in, the 2nd is time
	out, the 3rd starts a fresh visit (in), the 4th is its out, and so on. Returns [(label, duplicate)] for `times`
	(sorted). A touch within DUPLICATE_SECONDS of the previous one is a re-send and repeats that one's label."""
	out, last, prev, n = [], None, None, 0
	for t in times:
		t = get_datetime(t)
		if last is not None and (t - last).total_seconds() < DUPLICATE_SECONDS:
			out.append((prev, True))
			continue
		prev = IN_LABEL if n % 2 == 0 else OUT_LABEL
		n += 1
		last = t
		out.append((prev, False))
	return out


def _day_rows(employee, day, devices):
	return frappe.db.sql(
		"""SELECT name, time FROM `tabEmployee Checkin`
		WHERE employee = %(e)s AND device_id IN %(d)s AND DATE(time) = %(day)s ORDER BY time, creation""",
		{"e": employee, "d": tuple(devices), "day": day},
		as_dict=True,
	)


def relabel_day(employee, day):
	"""Re-number one person's touches for one day (after a new, late or removed punch)."""
	devices = device_ids()
	if not (devices and employee and has_checkin() and frappe.db.has_column("Employee Checkin", FIELD)):
		return
	rows = _day_rows(employee, day, devices)
	for r, (label, _) in zip(rows, sequence([r.time for r in rows])):
		frappe.db.set_value("Employee Checkin", r.name, FIELD, label, update_modified=False)


def label_checkin(doc, method=None):
	"""doc_events hook (validate): label a punch from the clinic device, and keep it out of HR's automatic attendance
	(the device is for the clinic alone)."""
	if doc.get("device_id") and doc.device_id in device_ids():
		if doc.get("employee") and doc.get("time"):
			day = get_datetime(doc.time).date()
			rows = [r for r in _day_rows(doc.employee, day, device_ids()) if r.name != doc.name]
			times = sorted([r.time for r in rows] + [doc.time])
			labels = sequence(times)
			doc.set(FIELD, labels[times.index(doc.time)][0])
		else:
			doc.set(FIELD, label_for(doc.log_type))
		if not doc.get("attendance"):
			doc.skip_auto_attendance = 1
	elif doc.get(FIELD):
		doc.set(FIELD, None)


def renumber_after_save(doc, method=None):
	"""doc_events hook (after_insert / on_trash): a late or removed punch shifts the ones after it."""
	if doc.get("device_id") and doc.device_id in device_ids() and doc.get("time"):
		relabel_day(doc.employee, get_datetime(doc.time).date())


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
	"""Label every punch from the clinic device by position in the person's day, and clear the label from any other
	device's punches."""
	if not has_checkin() or not frappe.db.has_column("Employee Checkin", FIELD):
		return 0
	devices = device_ids()
	frappe.db.sql(f"UPDATE `tabEmployee Checkin` SET `{FIELD}` = NULL WHERE `{FIELD}` IS NOT NULL AND `{FIELD}` != ''" + (
		" AND device_id NOT IN %(d)s" if devices else ""), {"d": tuple(devices)})
	if not devices:
		return 0
	rows = frappe.db.sql(
		f"""SELECT name, employee, time, `{FIELD}` AS label FROM `tabEmployee Checkin`
		WHERE device_id IN %(d)s ORDER BY employee, time, creation""",
		{"d": tuple(devices)},
		as_dict=True,
	)
	groups = {}
	for r in rows:
		groups.setdefault((r.employee, get_datetime(r.time).date()), []).append(r)
	for group in groups.values():
		for r, (label, _) in zip(group, sequence([g.time for g in group])):
			if r.label != label:
				frappe.db.set_value("Employee Checkin", r.name, FIELD, label, update_modified=False)
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
