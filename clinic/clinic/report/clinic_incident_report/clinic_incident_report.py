import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	conditions = {"incident_date": ["between", [filters.from_date, filters.to_date]]}
	for key in ("report_type", "severity", "patient_type"):
		if filters.get(key):
			conditions[key] = filters[key]
	if filters.get("work_related"):
		conditions["work_related"] = 1
	rows = frappe.get_all(
		"Clinic Incident", filters=conditions, order_by="incident_date asc",
		fields=["name", "incident_date", "report_type", "severity", "patient_name", "patient_type", "department",
			"employer", "cause", "injury_type", "work_related", "outcome", "lost_days", "status", "doshmis_status"],
	)
	columns = [
		{"label": _("Record"), "fieldname": "name", "fieldtype": "Link", "options": "Clinic Incident", "width": 150},
		{"label": _("Date"), "fieldname": "incident_date", "fieldtype": "Date", "width": 95},
		{"label": _("Type"), "fieldname": "report_type", "width": 90},
		{"label": _("Severity"), "fieldname": "severity", "width": 90},
		{"label": _("Patient"), "fieldname": "patient_name", "width": 170},
		{"label": _("Department"), "fieldname": "department", "width": 130},
		{"label": _("Farm"), "fieldname": "employer", "width": 120},
		{"label": _("Cause"), "fieldname": "cause", "width": 150},
		{"label": _("Injury"), "fieldname": "injury_type", "width": 130},
		{"label": _("Work-related"), "fieldname": "work_related", "fieldtype": "Check", "width": 90},
		{"label": _("Outcome"), "fieldname": "outcome", "width": 140},
		{"label": _("Days lost"), "fieldname": "lost_days", "fieldtype": "Int", "width": 80},
		{"label": _("Status"), "fieldname": "status", "width": 100},
		{"label": _("DOSHS"), "fieldname": "doshmis_status", "width": 110},
	]
	counts = {}
	for r in rows:
		counts[r.severity] = counts.get(r.severity, 0) + 1
	chart = {"data": {"labels": list(counts), "datasets": [{"values": list(counts.values())}]}, "type": "donut"} if counts else None
	return columns, rows, None, chart
