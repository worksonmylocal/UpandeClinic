"""Data and actions behind the Doctor / consultation page."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, getdate, nowdate

from clinic import stock
from clinic.api.common import (
	clean,
	minutes_since,
	patient_card,
	period_range,
	pick,
	require,
	to_number,
	today_start,
	user_name,
)

TEXT_FIELDS = [
	"presenting_complaint", "history_of_presenting_illness", "ros_cns", "ros_git", "ros_gut", "ros_cvs", "ros_rs",
	"ros_ms", "past_medical_history", "past_surgical_history", "current_medication", "drug_allergies",
	"family_history", "social_history", "occupational_history", "exam_general", "exam_cvs", "exam_rs",
	"exam_abdomen", "exam_cns", "exam_ms", "exam_other", "job_position", "fitness_status",
	"certificate_valid_until", "fitness_restrictions", "medical_remarks", "investigations_notes",
	"management_plan", "results_review_notes", "procedures_done", "patient_advice", "referral_facility", "referral_urgency",
	"referral_reason", "referral_notes", "follow_up_date", "follow_up_reason",
]
CHECK_FIELDS = ["work_related", "refer_out", "admitted", "follow_up_required"]
INT_FIELDS = ["sick_leave_days", "light_duty_days"]


@frappe.whitelist()
def dashboard():
	require("consultation")
	start = today_start()

	queue_sql = """
		SELECT v.name AS visit, v.patient, v.patient_name, v.patient_type, v.sex, v.age_years, v.department,
			v.visit_source, v.visit_purpose, v.status, v.consultation,
			t.triage_priority AS priority, t.chief_complaint, t.alerts, t.triage_datetime AS since
		FROM `tabClinic Visit` v LEFT JOIN `tabClinic Triage` t ON t.name = v.triage
		WHERE v.status = %s
		ORDER BY FIELD(t.triage_priority, 'Emergency', 'Urgent', 'Routine'), t.triage_datetime
	"""
	waiting = frappe.db.sql(queue_sql, "Waiting Consultation", as_dict=True)
	in_progress = frappe.db.sql(queue_sql, "In Consultation", as_dict=True)
	for row in waiting:
		row.wait_minutes = minutes_since(row.since)

	results = frappe.db.sql(
		"""
		SELECT c.name AS consultation, c.visit, c.patient_name, c.patient_type, c.sex, c.age_years,
			c.consultation_date AS since,
			SUM(r.result_status = 'Awaiting Results') AS awaiting,
			SUM(r.result_status = 'Results Received') AS received,
			SUM(r.result_flag IN ('Abnormal', 'Critical') AND r.result_status != 'Reviewed') AS abnormal,
			GROUP_CONCAT(CONCAT_WS('|', r.investigation, IFNULL(r.category, ''), r.result_status) ORDER BY r.idx SEPARATOR '~~') AS tests
		FROM `tabClinic Investigation Request` r
		JOIN `tabClinic Consultation` c ON c.name = r.parent
		JOIN `tabClinic Visit` v ON v.name = c.visit
		WHERE c.status = 'Completed' AND v.status != 'Cancelled' AND r.result_status != 'Reviewed'
		GROUP BY c.name
		ORDER BY received DESC, c.consultation_date
		""",
		as_dict=True,
	)
	for row in results:
		row.wait_minutes = minutes_since(row.since)
		row.tests = [
			dict(zip(("investigation", "category", "result_status"), t.split("|"))) for t in row.tests.split("~~")
		]

	today = frappe.db.sql(
		"""
		SELECT COUNT(*) AS seen,
			IFNULL(SUM(c.patient_type = 'Employee'), 0) AS employees,
			IFNULL(SUM(c.refer_out), 0) AS referrals_out,
			IFNULL(SUM(c.sick_leave_days), 0) AS sick_days,
			IFNULL(SUM(c.work_related), 0) AS work_related,
			IFNULL(SUM(c.consultation_type != 'Consultation'), 0) AS medicals,
			AVG(TIMESTAMPDIFF(MINUTE, t.triage_datetime, c.creation)) AS avg_wait
		FROM `tabClinic Consultation` c
		JOIN `tabClinic Visit` v ON v.name = c.visit
		LEFT JOIN `tabClinic Triage` t ON t.name = v.triage
		WHERE c.consultation_date >= %s
		""",
		start,
		as_dict=True,
	)[0]
	follow_ups = frappe.db.count(
		"Clinic Appointment",
		{"status": "Scheduled", "appointment_date": ["between", [nowdate(), add_days(nowdate(), 7)]]},
	)

	return {
		"kpis": {
			"waiting": len(waiting),
			"emergency": sum(1 for r in waiting if r.priority in ("Emergency", "Urgent")),
			"longest_wait": max((r.wait_minutes for r in waiting), default=0),
			"in_progress": len(in_progress),
			"results_pending": len(results),
			"results_received": sum(1 for r in results if r.received),
			"seen_today": today.seen,
			"employees_today": today.employees,
			"avg_wait": round(today.avg_wait or 0),
			"referrals_out": today.referrals_out,
			"sick_days": today.sick_days,
			"work_related": today.work_related,
			"medicals_today": today.medicals,
			"follow_ups_week": follow_ups,
		},
		"waiting": waiting,
		"in_progress": in_progress,
		"results": results,
	}


@frappe.whitelist()
def insights(period="day"):
	"""Doctor insights for today, this week or this month."""
	require("consultation")
	first, last = period_range(period)
	p = {"a": f"{first} 00:00:00", "b": f"{last} 23:59:59"}
	top_diagnoses = frappe.db.sql(
		"""
		SELECT d.diagnosis AS label, COUNT(DISTINCT c.name) AS total
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE c.consultation_date BETWEEN %(a)s AND %(b)s
		GROUP BY d.diagnosis ORDER BY total DESC LIMIT 8
		""",
		p,
		as_dict=True,
	)
	workload = frappe.db.sql(
		"""
		SELECT COUNT(*) AS consultations,
			COUNT(DISTINCT patient) AS patients,
			IFNULL(SUM(refer_out), 0) AS referrals,
			IFNULL(SUM(work_related), 0) AS work_related,
			IFNULL(SUM(follow_up_required), 0) AS follow_ups,
			IFNULL(SUM(sick_leave_days), 0) AS sick_days,
			IFNULL(SUM(light_duty_days), 0) AS light_duty_days,
			IFNULL(SUM(sick_leave_days > 0), 0) AS sick_offs,
			IFNULL(SUM(light_duty_days > 0), 0) AS light_duties,
			COUNT(DISTINCT IF(sick_leave_days > 0, patient, NULL)) AS sick_employees,
			(SELECT COUNT(*) FROM `tabClinic Investigation Request` r JOIN `tabClinic Consultation` c2
				ON c2.name = r.parent WHERE c2.consultation_date BETWEEN %(a)s AND %(b)s) AS investigations,
			(SELECT COUNT(*) FROM `tabClinic Prescription Item` x JOIN `tabClinic Consultation` c3
				ON c3.name = x.parent WHERE c3.consultation_date BETWEEN %(a)s AND %(b)s) AS prescriptions
		FROM `tabClinic Consultation` WHERE consultation_date BETWEEN %(a)s AND %(b)s
		""",
		p,
		as_dict=True,
	)[0]
	# From when the consultation started to when the doctor first closed it (completed it or sent the patient on)
	timed = frappe.db.sql(
		"""
		SELECT TIMESTAMPDIFF(MINUTE, consultation_date, ended_on) AS minutes FROM `tabClinic Consultation`
		WHERE consultation_date BETWEEN %(a)s AND %(b)s AND ended_on IS NOT NULL AND ended_on >= consultation_date
		""",
		p,
		pluck="minutes",
	)
	if period == "day":
		rows = frappe.db.sql(
			"""SELECT HOUR(consultation_date) AS k, COUNT(*) AS n FROM `tabClinic Consultation`
			WHERE consultation_date BETWEEN %(a)s AND %(b)s GROUP BY k""",
			p,
			as_dict=True,
		)
		series = {"labels": [f"{h:02d}:00" for h in range(5, 22)], "values": [next((r.n for r in rows if r.k == h), 0) for h in range(5, 22)]}
	else:
		rows = frappe.db.sql(
			"""SELECT DATE(consultation_date) AS k, COUNT(*) AS n FROM `tabClinic Consultation`
			WHERE consultation_date BETWEEN %(a)s AND %(b)s GROUP BY k""",
			p,
			as_dict=True,
		)
		days = [add_days(first, i) for i in range((last - first).days + 1)]
		series = {"labels": [d.strftime("%d %b") for d in days], "values": [next((r.n for r in rows if r.k == d), 0) for d in days]}
	return {
		"period": period,
		"range": {"from": str(first), "to": str(last)},
		"top_diagnoses": top_diagnoses,
		"diagnosed": sum(r.total for r in top_diagnoses),
		"workload": workload,
		"duration": {
			"measured": len(timed),
			"average": round(sum(timed) / len(timed)) if timed else None,
			"shortest": min(timed) if timed else None,
			"longest": max(timed) if timed else None,
		},
		"series": series,
	}


def _consultation_dict(name):
	return frappe.get_doc("Clinic Consultation", name).as_dict(no_nulls=True)


@frappe.whitelist()
def workspace(visit):
	"""Everything the doctor needs about one visit on a single screen."""
	require("consultation")
	visit_doc = frappe.get_doc("Clinic Visit", visit)
	patient = patient_card(visit_doc.patient)

	triage = frappe.db.get_value("Clinic Triage", visit_doc.triage, "*", as_dict=True) if visit_doc.triage else None
	consultation = _consultation_dict(visit_doc.consultation) if visit_doc.consultation else None

	return {
		"visit": visit_doc.as_dict(),
		"patient": patient,
		"triage": triage,
		"consultation": consultation,
		"history": patient_history(visit_doc.patient, exclude_visit=visit),
		"trend": frappe.get_all(
			"Clinic Triage",
			filters={"patient": visit_doc.patient},
			fields=["triage_datetime", "bp_systolic", "bp_diastolic", "weight_kg", "temperature", "pulse_rate"],
			order_by="triage_datetime desc",
			limit=6,
		),
		"doctor": user_name(frappe.session.user),
	}


def patient_history(patient, exclude_visit=None, limit=12):
	"""Earlier consultations with diagnoses, medication and lab findings."""
	filters = {"patient": patient}
	if exclude_visit:
		filters["visit"] = ["!=", exclude_visit]
	consultations = frappe.get_all(
		"Clinic Consultation",
		filters=filters,
		fields=["name", "visit", "consultation_date", "consultation_type", "fitness_status", "doctor",
				"presenting_complaint", "management_plan", "refer_out", "referral_facility", "sick_leave_days",
				"work_related", "status"],
		order_by="consultation_date desc",
		limit=limit,
	)
	for row in consultations:
		row.doctor_name = user_name(row.doctor)
		row.diagnoses = frappe.get_all(
			"Clinic Consultation Diagnosis", filters={"parent": row.name}, fields=["diagnosis", "diagnosis_type"]
		)
		row.prescriptions = frappe.get_all(
			"Clinic Prescription Item",
			filters={"parent": row.name},
			fields=["drug_name", "drug", "dose", "frequency", "duration_days"],
		)
	return consultations


@frappe.whitelist()
def patient_timeline(patient):
	require("consultation")
	return patient_history(patient, limit=30)


@frappe.whitelist()
def start(visit):
	"""Open the consultation for a visit (or return the one already open)."""
	require("consultation")
	existing = frappe.db.get_value("Clinic Visit", visit, "consultation")
	if existing:
		return existing
	return frappe.get_doc({"doctype": "Clinic Consultation", "visit": visit}).insert().name


def _apply(doc, data):
	for field in TEXT_FIELDS:
		if field in data:
			doc.set(field, clean(data[field]))
	for field in CHECK_FIELDS:
		if field in data:
			doc.set(field, cint(data[field]))
	for field in INT_FIELDS:
		if field in data:
			doc.set(field, to_number(data[field], integer=True) or 0)

	if "diagnoses" in data:
		doc.set("diagnoses", [
			pick(row, ["diagnosis", "diagnosis_type", "notes"]) for row in data["diagnoses"] if row.get("diagnosis")
		])
	if "prescriptions" in data:
		doc.set("prescriptions", [
			{
				**pick(row, ["drug", "dose", "route", "frequency", "instructions"]),
				"duration_days": to_number(row.get("duration_days"), integer=True),
				"quantity": to_number(row.get("quantity")),
			}
			for row in data["prescriptions"]
			if row.get("drug")
		])
	if "investigations" in data:
		doc.set("investigations", [
			pick(row, ["investigation", "urgency", "clinical_notes", "referred_to", "result_status", "result_date",
				"result_flag", "result_findings", "result_impression", "result_attachment"])
			for row in data["investigations"] if row.get("investigation")
		])
	if "medical_tests" in data:
		doc.set("medical_tests", [
			pick(row, ["test", "result", "findings"]) for row in data["medical_tests"] if row.get("test")
		])


@frappe.whitelist()
def save(name, data):
	require("consultation")
	doc = frappe.get_doc("Clinic Consultation", name)
	_apply(doc, frappe.parse_json(data))
	doc.save()
	return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def action(name, action, data=None):
	"""Save the form and then move the patient on: pharmacy or finish."""
	require("consultation")
	doc = frappe.get_doc("Clinic Consultation", name)
	if data:
		_apply(doc, frappe.parse_json(data))
		doc.save()
	if action == "send_to_pharmacy":
		doc.send_to_pharmacy()
	elif action == "complete":
		doc.complete_consultation()
	else:
		frappe.throw(_("Unknown action {0}").format(action))
	return {
		"name": doc.name,
		"status": doc.status,
		"visit_status": frappe.db.get_value("Clinic Visit", doc.visit, "status"),
	}


def drug_groups():
	"""The drug item group from Clinic Settings, with every sub-group under it."""
	group = frappe.db.get_single_value("Clinic Settings", "drug_item_group") or "Clinic Drugs"
	bounds = frappe.db.get_value("Item Group", group, ["lft", "rgt"])
	if not bounds:
		return [group]
	return frappe.get_all("Item Group", filters={"lft": [">=", bounds[0]], "rgt": ["<=", bounds[1]]}, pluck="name")


@frappe.whitelist()
def search_drugs(q=""):
	"""Only items in the clinic's drug group, so farm store items never show up when prescribing."""
	require("consultation")
	like = f"%{(q or '').strip()}%"
	items = frappe.get_all(
		"Item",
		filters={"disabled": 0, "item_group": ["in", drug_groups()]},
		or_filters=[["item_name", "like", like], ["item_code", "like", like]],
		fields=["name", "item_name", "stock_uom", "item_group"],
		order_by="item_name asc",
		limit=15,
	)
	free = stock.available([i.name for i in items])
	for item in items:
		item.available = free.get(item.name, 0)
	return items


@frappe.whitelist()
def add_diagnosis(diagnosis, icd_code=None, category="Other"):
	require("consultation")
	if not frappe.db.exists("Clinic Diagnosis", diagnosis):
		frappe.get_doc(
			{"doctype": "Clinic Diagnosis", "diagnosis": diagnosis, "icd_code": clean(icd_code), "category": category}
		).insert()
	return diagnosis


@frappe.whitelist()
def add_drug(drug_name):
	"""Quick-add a medicine that is not in the Item list yet (doctors cannot create Items directly)."""
	require("consultation")
	drug_name = drug_name.strip()
	existing = frappe.db.get_value("Item", {"item_name": drug_name}, "name")
	if existing:
		return frappe.db.get_value("Item", existing, ["name", "item_name", "stock_uom", "item_group"], as_dict=True)
	group = frappe.db.get_single_value("Clinic Settings", "drug_item_group") or "Clinic Drugs"
	if not frappe.db.exists("Item Group", group):
		frappe.get_doc(
			{"doctype": "Item Group", "item_group_name": group, "parent_item_group": "All Item Groups"}
		).insert(ignore_permissions=True)
	item = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": drug_name,
			"item_name": drug_name,
			"item_group": group,
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"description": "Added from the clinic consultation screen",
		}
	)
	item.insert(ignore_permissions=True)
	return {"name": item.name, "item_name": item.item_name, "stock_uom": item.stock_uom, "item_group": item.item_group}


@frappe.whitelist()
def seen(from_date=None, to_date=None, q=None):
	"""Patients whose consultation has been completed in a date range (today when none is given), for the Patients seen tab."""
	require("consultation")
	start = getdate(from_date or nowdate())
	end = getdate(to_date or start)
	if end < start:
		start, end = end, start
	search = (q or "").strip()
	rows = frappe.db.sql(
		"""
		SELECT c.name AS consultation, c.visit, c.patient_name, c.patient_type, c.sex, c.age_years,
			c.consultation_date, c.consultation_type, c.fitness_status, c.refer_out, c.sick_leave_days, c.work_related,
			(SELECT GROUP_CONCAT(d.diagnosis SEPARATOR ', ') FROM `tabClinic Consultation Diagnosis` d
				WHERE d.parent = c.name) AS diagnoses
		FROM `tabClinic Consultation` c
		WHERE c.status = 'Completed' AND c.consultation_date BETWEEN %(a)s AND %(b)s
			AND (%(q)s = '' OR c.patient_name LIKE %(like)s OR c.name LIKE %(like)s)
		ORDER BY c.consultation_date DESC LIMIT 500
		""",
		{"a": f"{start} 00:00:00", "b": f"{end} 23:59:59", "q": search, "like": f"%{search}%"},
		as_dict=True,
	)
	return {
		"range": {"from": str(start), "to": str(end)},
		"rows": rows,
		"summary": {
			"total": len(rows),
			"employees": sum(1 for r in rows if r.patient_type == "Employee"),
			"referred": sum(1 for r in rows if r.refer_out),
			"sick_days": sum(r.sick_leave_days or 0 for r in rows),
			"work_related": sum(1 for r in rows if r.work_related),
		},
	}


@frappe.whitelist()
def add_investigation(investigation, category="Laboratory"):
	require("consultation")
	investigation = investigation.strip()
	if not frappe.db.exists("Clinic Investigation Type", investigation):
		frappe.get_doc(
			{"doctype": "Clinic Investigation Type", "investigation_name": investigation, "category": category}
		).insert()
	return {"name": investigation, "category": category}
