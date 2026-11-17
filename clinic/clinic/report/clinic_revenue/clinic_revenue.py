import frappe
from frappe import _

GROUPS = {
	"Daily": ("DATE(b.paid_on)", _("Date"), "Data"),
	"Monthly": ("DATE_FORMAT(b.paid_on, '%%Y-%%m')", _("Month"), "Data"),
	"Employer": ("IFNULL(b.employer, 'Not set')", _("Employer"), "Data"),
	"Payment Method": ("IFNULL(b.payment_mode, 'No charge')", _("Payment Method"), "Data"),
}


def execute(filters=None):
	filters = frappe._dict(filters or {})
	expr, label, ftype = GROUPS.get(filters.get("group_by") or "Daily", GROUPS["Daily"])
	columns = [
		{"label": label, "fieldname": "period", "fieldtype": ftype, "width": 190},
		{"label": _("Receipts"), "fieldname": "receipts", "fieldtype": "Int", "width": 90},
		{"label": _("Consultations"), "fieldname": "consultation", "fieldtype": "Currency", "width": 130},
		{"label": _("Lab Tests"), "fieldname": "lab", "fieldtype": "Currency", "width": 120},
		{"label": _("Procedures"), "fieldname": "procedures", "fieldtype": "Currency", "width": 120},
		{"label": _("Drugs"), "fieldname": "drugs", "fieldtype": "Currency", "width": 120},
		{"label": _("Total Collected"), "fieldname": "total", "fieldtype": "Currency", "width": 150},
	]
	conditions = ""
	if filters.get("employer"):
		conditions += " AND b.employer = %(employer)s"
	data = frappe.db.sql(
		f"""
		SELECT {expr} AS period, COUNT(*) AS receipts, SUM(b.consultation_total) AS consultation,
			SUM(b.procedure_total) AS procedures, SUM(b.lab_total) AS lab, SUM(b.drug_total) AS drugs, SUM(b.total) AS total
		FROM `tabClinic Bill` b
		WHERE b.status = 'Paid' AND IFNULL(b.waived, 0) = 0 AND DATE(b.paid_on) BETWEEN %(from_date)s AND %(to_date)s {conditions}
		GROUP BY period ORDER BY period
		""",
		filters,
		as_dict=True,
	)
	chart = {
		"data": {"labels": [str(r.period) for r in data], "datasets": [{"name": _("Total Collected"), "values": [float(r.total or 0) for r in data]}]},
		"type": "bar",
	}
	return columns, data, None, chart
