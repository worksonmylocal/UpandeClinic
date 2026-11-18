import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": _("Farm"), "fieldname": "farm", "fieldtype": "Link", "options": "Clinic Employer", "width": 170},
		{"label": _("Dependant"), "fieldname": "patient", "fieldtype": "Link", "options": "Clinic Patient", "width": 130},
		{"label": _("Dependant Name"), "fieldname": "patient_name", "fieldtype": "Data", "width": 170},
		{"label": _("Relationship"), "fieldname": "relationship", "fieldtype": "Data", "width": 100},
		{"label": _("Employee (Parent)"), "fieldname": "parent", "fieldtype": "Data", "width": 170},
		{"label": _("Visits"), "fieldname": "visits", "fieldtype": "Int", "width": 70},
		{"label": _("Total Cost"), "fieldname": "total", "fieldtype": "Currency", "width": 120},
		{"label": _("Invoiced (unpaid)"), "fieldname": "outstanding", "fieldtype": "Currency", "width": 130},
		{"label": _("Paid"), "fieldname": "paid", "fieldtype": "Currency", "width": 110},
		{"label": _("Not Yet Billed"), "fieldname": "open_amount", "fieldtype": "Currency", "width": 120},
	]
	farm = " AND p.dependant_farm = %(farm)s" if filters.get("farm") else ""
	data = frappe.db.sql(
		f"""
		SELECT p.dependant_farm AS farm, p.name AS patient, p.full_name AS patient_name,
			p.dependant_relationship AS relationship, p.parent_name AS parent,
			COUNT(b.name) AS visits, IFNULL(SUM(b.total), 0) AS total,
			IFNULL(SUM(CASE WHEN b.status = 'Invoiced' THEN b.total END), 0) AS outstanding,
			IFNULL(SUM(CASE WHEN b.status = 'Paid' THEN b.total END), 0) AS paid,
			IFNULL(SUM(CASE WHEN b.status = 'Open' THEN b.total END), 0) AS open_amount
		FROM `tabClinic Patient` p
		LEFT JOIN `tabClinic Bill` b ON b.patient = p.name AND b.status != 'Cancelled'
			AND DATE(b.bill_date) BETWEEN %(from_date)s AND %(to_date)s
		WHERE p.is_dependant = 1 {farm}
		GROUP BY p.name ORDER BY p.dependant_farm, total DESC, p.full_name
		""",
		filters,
		as_dict=True,
	)
	by_farm = {}
	for r in data:
		by_farm[r.farm] = by_farm.get(r.farm, 0) + flt(r.total)
	chart = {"data": {"labels": list(by_farm), "datasets": [{"name": _("Cost"), "values": list(by_farm.values())}]}, "type": "bar"} if by_farm else None
	summary = [
		{"label": _("Dependants"), "value": len(data), "datatype": "Int", "indicator": "Blue"},
		{"label": _("Total Cost"), "value": sum(flt(r.total) for r in data), "datatype": "Currency", "indicator": "Orange"},
		{"label": _("Unpaid by Farms"), "value": sum(flt(r.outstanding) for r in data), "datatype": "Currency", "indicator": "Red"},
	]
	return columns, data, None, chart, summary
