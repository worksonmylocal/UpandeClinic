"""The Reports tab: every clinic report in one list, each downloadable on the clinic letterhead."""

import json

import frappe
from frappe import _
from frappe.utils import formatdate, getdate, now_datetime

from clinic.api.common import clinic_profile, require

PT = {"fieldname": "patient_type", "label": "Patient type", "type": "select", "options": ["", "Employee", "Community Member"]}
FARM = {"fieldname": "employer", "label": "Farm", "type": "farm"}
FROM, TO = {"fieldname": "from_date", "label": "From", "type": "date", "default": "month_start"}, {"fieldname": "to_date", "label": "To", "type": "date", "default": "today"}
DATES = [FROM, TO]

# group, report (as named in Frappe), what it shows, the filters it takes, wide (printed landscape)
REPORTS = [
	("Visits & clinical", "Clinic Visit Summary", "Visits over time by patient type.", DATES + [PT, {"fieldname": "group_by", "label": "Group by", "type": "select", "options": ["Daily", "Weekly", "Monthly"], "default": "Daily"}], False),
	("Visits & clinical", "Clinic Attendance Summary", "Antenatal, MCH & postnatal and TB clinic attendances.", DATES + [PT, {"fieldname": "clinic_unit", "label": "Clinic", "type": "select", "options": ["", "Antenatal Clinic", "MCH & Postnatal Clinic", "TB Clinic"]}], True),
	("Visits & clinical", "Clinic Morbidity Report", "Diagnoses by category, for the period.", DATES + [PT, {"fieldname": "diagnosis_type", "label": "Diagnosis type", "type": "select", "options": ["", "Provisional", "Confirmed"]}], False),
	("Visits & clinical", "Clinic Referral Register", "Patients referred in and out.", DATES + [PT, {"fieldname": "direction", "label": "Direction", "type": "select", "options": ["", "In", "Out"]}], True),
	("Visits & clinical", "Clinic Lab Test Summary", "Laboratory tests done and their results.", DATES + [PT], True),
	("Visits & clinical", "Clinic Lab Statistics", "Malaria, SAT, Hb, RBS and urinalysis: tests done and how many were positive, low or high.", DATES + [PT], False),
	("Visits & clinical", "TB Screening Register", "TB screening outcomes.", DATES + [PT, {"fieldname": "source", "label": "Seen at", "type": "select", "options": ["", "Consultation", "Antenatal Clinic", "MCH & Postnatal Clinic", "TB Clinic"]}], True),
	("Visits & clinical", "Clinic Incident Report", "Accidents and incidents reported.", DATES + [PT, {"fieldname": "work_related", "label": "Work-related only", "type": "check"}], True),
	("Mother & child", "CWC Register", "Children registered at the child welfare clinic.", [
		{"fieldname": "from_date", "label": "Registered from", "type": "date", "default": "months_ago_24"}, {"fieldname": "to_date", "label": "Registered to", "type": "date", "default": "today"},
		{"fieldname": "status", "label": "Status", "type": "select", "options": ["", "Active", "Transferred Out", "Completed", "Deceased", "Inactive"], "default": "Active"},
		{"fieldname": "defaulters_only", "label": "Defaulters only", "type": "check"}], True),
	("Mother & child", "Immunization Coverage", "Immunization coverage for the period.", DATES, False),
	("Mother & child", "Immunization Defaulters", "Children behind on their immunizations.", [{"fieldname": "min_days_late", "label": "At least this many days late", "type": "int", "default": 1}], True),
	("Employers & farms", "Employee Health by Department", "Employee visits and illness by department.", DATES, False),
	("Employers & farms", "Clinic Dependants Cost", "What each farm's dependants have cost, per dependant.", DATES + [{"fieldname": "farm", "label": "Farm", "type": "farm"}], True),
	("Money", "Clinic Revenue", "Money collected and billed.", DATES + [FARM, {"fieldname": "group_by", "label": "Group by", "type": "select", "options": ["Daily", "Monthly", "Employer", "Payment Method"], "default": "Daily"}], False),
	("Money", "Farm Invoices", "Invoices raised to farms and whether they are paid.", [
		{"fieldname": "from_date", "label": "From", "type": "date", "default": "months_ago_3"}, TO, FARM,
		{"fieldname": "status", "label": "Show", "type": "select", "options": ["Outstanding", "Paid", "All"], "default": "Outstanding"}], True),
	("Money", "Clinic Waived Fees", "Fees waived for patients who could not pay, with reason and authoriser.", DATES, True),
]


def _permitted(name):
	try:
		return frappe.db.exists("Report", name) and frappe.get_doc("Report", name).is_permitted()
	except Exception:
		return False


@frappe.whitelist()
def list_reports():
	require("reports")
	rows = [
		{"group": g, "name": n, "description": d, "filters": f, "wide": w}
		for g, n, d, f, w in REPORTS if _permitted(n)
	]
	return {"reports": rows, "farms": frappe.get_all("Clinic Employer", pluck="name", order_by="name")}


def _describe(filters):
	"""The chosen filters in words, for the line under the title."""
	parts = []
	if filters.get("from_date") or filters.get("to_date"):
		a, b = filters.get("from_date"), filters.get("to_date")
		parts.append(f"{formatdate(a) if a else '…'} to {formatdate(b) if b else '…'}")
	for key, value in filters.items():
		if key in ("from_date", "to_date") or value in (None, "", 0, "0"):
			continue
		label = key.replace("_", " ").capitalize()
		parts.append(label if value in (1, "1", True) else f"{label}: {value}")
	return " · ".join(parts)


@frappe.whitelist()
def run(report, filters=None):
	"""Run one report as the current user (the report's own roles apply) and shape it for printing."""
	require("reports")
	spec = next((r for r in REPORTS if r[1] == report), None)
	if not spec:
		frappe.throw(_("Unknown report"))
	filters = frappe.parse_json(filters) if isinstance(filters, str) else (filters or {})
	filters = {k: v for k, v in filters.items() if v not in (None, "")}
	from frappe.desk.query_report import run as run_report

	res = run_report(report, filters=filters, ignore_prepared_report=True)
	columns = [c for c in res.get("columns", []) if isinstance(c, dict) and not c.get("hidden")]
	rows = []
	for r in res.get("result", []):
		if isinstance(r, (list, tuple)):
			r = {c["fieldname"]: v for c, v in zip(res["columns"], r)}
		rows.append(r)
	return {
		"clinic": clinic_profile(), "title": report, "description": spec[2], "wide": spec[4],
		"filters_text": _describe(filters), "columns": columns, "rows": rows,
		"summary": res.get("report_summary") or [], "message": res.get("message"),
		"printed_on": str(now_datetime()), "printed_by": frappe.db.get_value("User", frappe.session.user, "full_name"),
	}
