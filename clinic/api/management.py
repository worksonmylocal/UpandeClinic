"""The Management tab: the weekly duty rota (more management tools can sit alongside it)."""

import frappe
from frappe import _
from frappe.utils import add_days, getdate, nowdate

from clinic import rota
from clinic.api.common import clinic_profile, require

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _settings():
	s = frappe.get_cached_doc("Clinic Settings")
	staff = [
		{"name": r.staff_name, "on_call_order": r.on_call_order or 0}
		for r in sorted(s.rota_staff, key=lambda r: r.idx) if r.active
	]
	return s, staff


def _anchor(settings):
	if not settings.rota_anchor:
		frappe.throw(_("Set 'Rota Week 1 Starts On' in Clinic Settings first"))
	return getdate(settings.rota_anchor)


def _monday(week_start):
	return rota.monday_of(getdate(week_start or nowdate()))


def _history(anchor):
	"""Which weeks each person worked the weekend, for the fairness of the next rota."""
	out = []
	for name in frappe.get_all("Clinic Duty Rota", pluck="name", order_by="week_start asc"):
		doc = frappe.get_doc("Clinic Duty Rota", name)
		out.append((rota.weeks_since(anchor, doc.week_start), [r.staff_name for r in doc.rows if r.sat == "M"]))
	return out


def _shape(doc):
	if not doc:
		return None
	return {
		"name": doc.name, "status": doc.status, "on_call": doc.on_call, "notes": doc.notes, "week_label": doc.week_label,
		"rows": [{"staff_name": r.staff_name, "days": [r.get(d) or "" for d in rota.DAYS]} for r in doc.rows],
	}


@frappe.whitelist()
def rota_state(week_start=None):
	require("management")
	settings, staff = _settings()
	anchor = _anchor(settings)
	monday = _monday(week_start)
	doc = frappe.get_doc("Clinic Duty Rota", str(monday)) if frappe.db.exists("Clinic Duty Rota", str(monday)) else None
	shaped = _shape(doc)
	recent = frappe.get_all("Clinic Duty Rota", fields=["week_start", "week_label", "on_call", "status"], order_by="week_start desc", limit=12)
	return {
		"week_start": str(monday), "week_end": str(add_days(monday, 6)), "label": rota.week_label(anchor, monday),
		"days": [{"label": DAY_LABELS[i], "date": str(add_days(monday, i))} for i in range(7)],
		"rota": shaped, "staff": staff, "recent": recent,
		"problems": rota.check({r["staff_name"]: r["days"] for r in shaped["rows"]}) if shaped else [],
		"proposed_on_call": rota.build(staff, rota.weeks_since(anchor, monday))["on_call"] if staff else None,
	}


def _generate_one(staff, anchor, monday, replace):
	existing = frappe.db.exists("Clinic Duty Rota", str(monday))
	if existing and not replace:
		return False
	n = rota.weeks_since(anchor, monday)
	built = rota.build(staff, n, [h for h in _history(anchor) if h[0] != n])
	doc = frappe.get_doc("Clinic Duty Rota", existing) if existing else frappe.new_doc("Clinic Duty Rota")
	doc.week_start = monday
	doc.week_label = rota.week_label(anchor, monday)
	doc.on_call = built["on_call"]
	doc.status = "Draft"
	doc.rows = []
	for s in staff:
		doc.append("rows", {"staff_name": s["name"], **dict(zip(rota.DAYS, built["rows"][s["name"]]))})
	doc.flags.ignore_permissions = True
	doc.save() if existing else doc.insert()
	return True


@frappe.whitelist()
def generate_rota(week_start, replace=0, weeks=1):
	"""Work out the rota for one week or several in a row (each week builds on the weekends already given out).
	An existing week is only replaced when asked, and only for a single week."""
	require("management")
	settings, staff = _settings()
	if not staff:
		frappe.throw(_("Add the staff on the rota in Clinic Settings first"))
	anchor = _anchor(settings)
	monday = _monday(week_start)
	weeks = max(1, min(int(weeks or 1), 26))
	if weeks == 1:
		if not _generate_one(staff, anchor, monday, int(replace)):
			frappe.throw(_("A rota already exists for the week of {0}").format(monday))
		return rota_state(str(monday))
	created = skipped = 0
	for i in range(weeks):
		if _generate_one(staff, anchor, add_days(monday, 7 * i), False):
			created += 1
		else:
			skipped += 1
	state = rota_state(str(monday))
	state["range_result"] = {"created": created, "skipped": skipped, "weeks": weeks}
	return state


@frappe.whitelist()
def save_rota(week_start, rows, on_call=None, status="Draft", notes=None):
	"""Keep the manager's hand edits (a swap, leave) and publish when happy."""
	require("management")
	monday = _monday(week_start)
	doc = frappe.get_doc("Clinic Duty Rota", str(monday))
	rows = frappe.parse_json(rows)
	by = {r["staff_name"]: r["days"] for r in rows}
	for r in doc.rows:
		if r.staff_name in by:
			for d, code in zip(rota.DAYS, by[r.staff_name]):
				r.set(d, code if code in ("M", "A", "O", "x") else "")
	doc.on_call = on_call or doc.on_call
	doc.status = "Published" if status == "Published" else "Draft"
	doc.notes = notes
	doc.flags.ignore_permissions = True
	doc.save()
	return rota_state(str(monday))


@frappe.whitelist()
def rota_document(week_start, weeks=1):
	"""One or more weeks for printing: every week in the range that has a rota."""
	require("management")
	monday = _monday(week_start)
	out = []
	for i in range(max(1, min(int(weeks or 1), 26))):
		state = rota_state(str(add_days(monday, 7 * i)))
		if state["rota"]:
			out.append(state)
	if not out:
		frappe.throw(_("There is no rota for this period yet"))
	return {"clinic": clinic_profile(), "weeks": out}
