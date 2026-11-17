import frappe
from frappe import _


def execute(filters=None):
	filters = filters or {}
	columns = [
		{"label": _("Waived On"), "fieldname": "waived_on", "fieldtype": "Datetime", "width": 160},
		{"label": _("Bill"), "fieldname": "name", "fieldtype": "Link", "options": "Clinic Bill", "width": 140},
		{"label": _("Patient"), "fieldname": "patient_name", "fieldtype": "Data", "width": 180},
		{"label": _("Amount Waived"), "fieldname": "waived_amount", "fieldtype": "Currency", "width": 120},
		{"label": _("Reason for Waiver"), "fieldname": "waiver_reason", "fieldtype": "Data", "width": 300},
		{"label": _("Authorised By"), "fieldname": "waived_by", "fieldtype": "Link", "options": "User", "width": 170},
		{"label": _("Pharmacist"), "fieldname": "received_by", "fieldtype": "Link", "options": "User", "width": 170},
		{"label": _("Receipt"), "fieldname": "receipt_no", "fieldtype": "Data", "width": 130},
	]
	data = frappe.get_all(
		"Clinic Bill",
		filters={"waived": 1, "waived_on": ["between", [f"{filters.get('from_date')} 00:00:00", f"{filters.get('to_date')} 23:59:59"]]},
		fields=["waived_on", "name", "patient_name", "waived_amount", "waiver_reason", "waived_by", "received_by", "receipt_no"],
		order_by="waived_on desc",
	)
	return columns, data
