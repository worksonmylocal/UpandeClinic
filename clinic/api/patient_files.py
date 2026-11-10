"""Patient files: find a patient and download their file (latest encounter or the whole history)."""

import frappe

from clinic.api.common import require_any


@frappe.whitelist()
def search(q=None, patient_type=None):
	"""Patients matching the search, with how many consultations they have and the latest one."""
	require_any("consultation")
	q = (q or "").strip()
	cond, args = ["1=1"], {"like": f"%{q}%"}
	if q:
		cond.append(
			"(p.full_name LIKE %(like)s OR p.name LIKE %(like)s OR p.national_id LIKE %(like)s "
			"OR p.phone LIKE %(like)s OR p.staff_no LIKE %(like)s)"
		)
	if patient_type:
		cond.append("p.patient_type = %(pt)s")
		args["pt"] = patient_type
	return frappe.db.sql(
		f"""
		SELECT p.name AS patient, p.full_name, p.patient_type, p.sex, p.date_of_birth, p.national_id, p.phone,
			p.staff_no, p.employer,
			(SELECT COUNT(*) FROM `tabClinic Consultation` c WHERE c.patient = p.name) AS encounters,
			(SELECT c.name FROM `tabClinic Consultation` c WHERE c.patient = p.name
				ORDER BY c.consultation_date DESC LIMIT 1) AS latest,
			(SELECT MAX(c.consultation_date) FROM `tabClinic Consultation` c WHERE c.patient = p.name) AS last_seen
		FROM `tabClinic Patient` p WHERE {' AND '.join(cond)}
		ORDER BY (last_seen IS NULL), last_seen DESC, p.full_name LIMIT 100
		""",
		args,
		as_dict=True,
	)
