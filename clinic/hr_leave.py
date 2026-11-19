"""Sick leave from the clinic to HR.

When the doctor closes a consultation with sick-off days for an employee who has an Employee
record (the farm's HR), the days are filed as Leave Applications:

* Work-related cases use the "Sick Leave (Work Injury)" type.
* Otherwise Full Pay is used first, then Half Pay for the days beyond the Full Pay balance.
* Days covered by a balance are filed Approved (submitted) straight from the encounter.
* Days with no balance left are filed as a draft (status Open) for HR to approve.

HRMS is only installed on the live site, so everything here degrades quietly when it is missing.
"""
import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate

FULL, HALF, INJURY = "Sick Leave (Full Pay)", "Sick Leave (Half Pay)", "Sick Leave (Work Injury)"
MAX_SPAN = 60


def hr_ready():
	return bool(frappe.db.exists("DocType", "Leave Application")) and bool(frappe.db.exists("DocType", "Employee"))


def employee_for(patient):
	"""The Employee record behind a clinic patient, or None when the patient is not on the farm's HR."""
	p = frappe.db.get_value("Clinic Patient", patient, ["patient_type", "employee", "is_dependant"], as_dict=True)
	if not p or p.patient_type != "Employee" or p.is_dependant or not p.employee or not hr_ready():
		return None
	if not frappe.db.exists("Employee", p.employee):
		return None
	return p.employee


def _remaining(employee, on_date):
	"""Sick-leave days left per type, after approved leave and drafts waiting for approval."""
	from hrms.hr.doctype.leave_application.leave_application import get_leave_details

	rows = (get_leave_details(employee, on_date) or {}).get("leave_allocation", {})
	out = {}
	for leave_type in (FULL, HALF):
		r = rows.get(leave_type) or {}
		out[leave_type] = max(0.0, flt(r.get("remaining_leaves")) - flt(r.get("leaves_pending_approval")))
	return out


def balances(patient, on_date=None):
	"""For the consultation screen: None when the patient is not a farm employee."""
	employee = employee_for(patient)
	if not employee:
		return None
	on_date = getdate(on_date)
	try:
		left = _remaining(employee, on_date)
	except Exception:
		frappe.clear_last_message()
		return None
	return {"employee": employee, "full": left[FULL], "half": left[HALF]}


def plan(patient, days, work_related=0, on_date=None):
	"""Split the sick-off into [(leave_type, days, status)] without creating anything."""
	days = cint(days)
	employee = employee_for(patient)
	if not employee or days <= 0:
		return {"employee": employee, "parts": []}
	if cint(work_related):
		return {"employee": employee, "parts": [{"leave_type": INJURY, "days": days, "status": "Approved"}]}
	left = _remaining(employee, getdate(on_date))
	parts, todo = [], days
	for leave_type in (FULL, HALF):
		take = min(todo, int(left[leave_type]))
		if take > 0:
			parts.append({"leave_type": leave_type, "days": take, "status": "Approved"})
			todo -= take
	if todo > 0:  # nothing left in either balance: HR decides
		parts.append({"leave_type": HALF, "days": todo, "status": "Open"})
	return {"employee": employee, "parts": parts}


def _approver(employee):
	user = frappe.db.get_value("Employee", employee, "leave_approver")
	if user:
		return user
	dept = frappe.db.get_value("Employee", employee, "department")
	if dept:
		return frappe.db.get_value("Department Approver", {"parent": dept, "parentfield": "leave_approvers"}, "approver")
	return None


def _to_date(employee, leave_type, start, days):
	"""Last date that gives exactly `days` leave days (holidays are skipped when the type excludes them)."""
	from hrms.hr.doctype.leave_application.leave_application import get_number_of_leave_days

	end = add_days(start, days - 1)
	for _i in range(MAX_SPAN):
		if flt(get_number_of_leave_days(employee, leave_type, start, end)) >= days:
			return end
		end = add_days(end, 1)
	return add_days(start, days - 1)


def file_for_consultation(doc):
	"""Create the Leave Applications for a closed consultation. Never blocks the consultation."""
	if doc.get("hr_leave_applications") or cint(doc.sick_leave_days) <= 0:
		return
	lines = []
	try:
		msg = _file(doc, lines)
		if msg:
			lines.append(msg)
	except Exception as e:
		lines.append(_("HR leave was not fully created: {0}").format(frappe.utils.strip_html(str(e))[:300]))
		frappe.log_error(title="Sick leave to HR failed", message=frappe.get_traceback())
	frappe.clear_messages()
	if lines:
		doc.db_set("hr_leave_applications", "\n".join(lines), update_modified=False)


def _file(doc, lines):
	start = getdate(doc.consultation_date)
	p = plan(doc.patient, doc.sick_leave_days, doc.work_related, start)
	employee = p["employee"]
	if not employee:
		return ""
	approver = _approver(employee)
	if not approver:
		return _("No leave approver is set for {0}, so no leave was created in HR.").format(employee)
	company = frappe.db.get_value("Employee", employee, "company")
	user = frappe.session.user
	frappe.set_user("Administrator")  # doctors have no HR permissions; the encounter is the authority
	try:
		for part in p["parts"]:
			end = _to_date(employee, part["leave_type"], start, part["days"])
			la = frappe.get_doc(
				{
					"doctype": "Leave Application",
					"employee": employee,
					"company": company,
					"leave_type": part["leave_type"],
					"from_date": start,
					"to_date": end,
					"posting_date": getdate(),
					"status": part["status"],
					"leave_approver": approver,
					"description": _("Sick off from clinic consultation {0} ({1}){2}").format(
						doc.name, doc.patient_name, _(" - work related") if cint(doc.work_related) else ""
					),
				}
			)
			la.insert(ignore_permissions=True)
			if part["status"] == "Approved":
				la.submit()
			lines.append(f"{la.name}: {part['leave_type']} {la.total_leave_days:g} day(s) "
				f"{la.from_date} to {la.to_date}, " + (_("approved") if part["status"] == "Approved" else _("draft, awaiting HR approval")))
			start = add_days(end, 1)
	finally:
		frappe.set_user(user)
	return ""
