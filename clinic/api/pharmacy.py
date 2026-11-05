"""Data and actions behind the Pharmacy page."""

import frappe
from frappe import _
from clinic import stock
from clinic.api.common import clean, minutes_since, patient_card, period_range, require, to_number, today_start, user_name


@frappe.whitelist()
def dashboard():
	require("pharmacy")
	start = today_start()

	pending = frappe.db.sql(
		"""
		SELECT d.name, d.visit, d.patient, d.patient_name, d.patient_type, d.creation AS since,
			c.doctor, v.sex, v.age_years, p.allergies,
			(SELECT COUNT(*) FROM `tabClinic Dispensing Item` i WHERE i.parent = d.name) AS item_count,
			(SELECT GROUP_CONCAT(x.diagnosis SEPARATOR ', ') FROM `tabClinic Consultation Diagnosis` x
				WHERE x.parent = d.consultation) AS diagnoses
		FROM `tabClinic Dispensing` d
		LEFT JOIN `tabClinic Consultation` c ON c.name = d.consultation
		LEFT JOIN `tabClinic Visit` v ON v.name = d.visit
		LEFT JOIN `tabClinic Patient` p ON p.name = d.patient
		WHERE d.docstatus = 0 ORDER BY d.creation
		""",
		as_dict=True,
	)
	for row in pending:
		row.wait_minutes = minutes_since(row.since)
		row.doctor_name = user_name(row.doctor)

	dispensed = frappe.db.sql(
		"""
		SELECT d.name, d.visit, d.patient_name, d.patient_type, d.dispensed_on, d.pharmacist,
			(SELECT COUNT(*) FROM `tabClinic Dispensing Item` i WHERE i.parent = d.name) AS item_count
		FROM `tabClinic Dispensing` d WHERE d.docstatus = 1 AND d.dispensed_on >= %s
		ORDER BY d.dispensed_on DESC
		""",
		start,
		as_dict=True,
	)
	for row in dispensed:
		row.pharmacist_name = user_name(row.pharmacist)

	stats = frappe.db.sql(
		"""
		SELECT COUNT(*) AS prescriptions,
			IFNULL(SUM(d.patient_type = 'Employee'), 0) AS employees,
			AVG(TIMESTAMPDIFF(MINUTE, d.creation, d.dispensed_on)) AS avg_wait,
			(SELECT IFNULL(SUM(i.dispensed_qty), 0) FROM `tabClinic Dispensing Item` i
				JOIN `tabClinic Dispensing` d2 ON d2.name = i.parent
				WHERE d2.docstatus = 1 AND d2.dispensed_on >= %(start)s) AS units,
			(SELECT COUNT(*) FROM `tabClinic Dispensing Item` i
				JOIN `tabClinic Dispensing` d3 ON d3.name = i.parent
				WHERE d3.docstatus = 1 AND d3.dispensed_on >= %(start)s) AS line_count
		FROM `tabClinic Dispensing` d WHERE d.docstatus = 1 AND d.dispensed_on >= %(start)s
		""",
		{"start": start},
		as_dict=True,
	)[0]

	return {
		"kpis": {
			"waiting": len(pending),
			"longest_wait": max((r.wait_minutes for r in pending), default=0),
			"with_allergies": sum(1 for r in pending if r.allergies),
			"dispensed_today": stats.prescriptions,
			"units_today": round(stats.units or 0),
			"lines_today": stats.line_count,
			"avg_wait": round(stats.avg_wait or 0),
			"employees_today": stats.employees,
		},
		"pending": pending,
		"dispensed": dispensed,
	}


@frappe.whitelist()
def insights(period="month"):
	"""Most dispensed drugs for today, this week or this month."""
	require("pharmacy")
	first, last = period_range(period)
	p = {"a": f"{first} 00:00:00", "b": f"{last} 23:59:59"}
	top_drugs = frappe.db.sql(
		"""
		SELECT IFNULL(i.drug_name, i.drug) AS label, i.drug, SUM(i.dispensed_qty) AS qty, COUNT(DISTINCT d.name) AS prescriptions,
			COUNT(DISTINCT d.patient) AS patients, MAX(i.uom) AS uom
		FROM `tabClinic Dispensing Item` i JOIN `tabClinic Dispensing` d ON d.name = i.parent
		WHERE d.docstatus = 1 AND d.dispensed_on BETWEEN %(a)s AND %(b)s AND i.dispensed_qty > 0
		GROUP BY i.drug, i.drug_name ORDER BY qty DESC LIMIT 10
		""",
		p,
		as_dict=True,
	)
	totals = frappe.db.sql(
		"""
		SELECT COUNT(DISTINCT d.name) AS dispensings, IFNULL(SUM(i.dispensed_qty), 0) AS units,
			COUNT(DISTINCT i.drug) AS drugs
		FROM `tabClinic Dispensing Item` i JOIN `tabClinic Dispensing` d ON d.name = i.parent
		WHERE d.docstatus = 1 AND d.dispensed_on BETWEEN %(a)s AND %(b)s AND i.dispensed_qty > 0
		""",
		p,
		as_dict=True,
	)[0]
	return {"period": period, "range": {"from": str(first), "to": str(last)}, "top_drugs": top_drugs, "totals": totals}


@frappe.whitelist()
def get_dispensing(name):
	require("pharmacy")
	doc = frappe.get_doc("Clinic Dispensing", name)
	data = doc.as_dict(no_nulls=True)
	data["patient_card"] = patient_card(doc.patient)
	data["doctor_name"] = user_name(frappe.db.get_value("Clinic Consultation", doc.consultation, "doctor"))
	data["diagnoses"] = frappe.get_all(
		"Clinic Consultation Diagnosis", filters={"parent": doc.consultation}, pluck="diagnosis"
	)
	data["stock"] = stock.on_hand([i.drug for i in doc.items])
	data["weight_kg"] = frappe.db.get_value(
		"Clinic Triage", frappe.db.get_value("Clinic Visit", doc.visit, "triage"), "weight_kg"
	)
	return data


@frappe.whitelist()
def dispense(name, items, notes=None, submit=1):
	"""Record what was handed out and close the visit."""
	require("pharmacy")
	rows = {row["name"]: row for row in frappe.parse_json(items)}
	doc = frappe.get_doc("Clinic Dispensing", name)
	if doc.docstatus != 0:
		frappe.throw(_("{0} has already been dispensed").format(name))
	for row in doc.items:
		if row.name in rows:
			row.dispensed_qty = to_number(rows[row.name].get("dispensed_qty")) or 0
			row.not_available = 1 if rows[row.name].get("not_available") else 0
	doc.notes = clean(notes)
	doc.save()
	if int(submit):
		doc.submit()
	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"visit": doc.visit,
		"visit_status": frappe.db.get_value("Clinic Visit", doc.visit, "status"),
	}
