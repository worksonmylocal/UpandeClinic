"""Accidents and incidents: recorded from the consultation, reported monthly."""

import frappe
from frappe import _
from frappe.utils import add_months, cint, get_first_day, get_last_day, getdate, now_datetime, nowdate

from clinic.api.common import clean, clinic_profile, pick, require, require_any, user_name

FIELDS = [
	"report_type", "incident_date", "incident_time", "location", "severity", "status", "work_related", "cause",
	"injury_type", "body_part", "witness", "reported_to", "description", "stabilization_steps", "outcome",
	"lost_days", "referral_destination", "accompanied_by_co", "root_cause", "corrective_actions",
	"doshmis_status", "insurance_status",
]
LIST_FIELDS = ["name", "report_type", "incident_date", "incident_time", "location", "severity", "status", "work_related",
	"patient", "patient_name", "patient_type", "department", "employer", "visit", "consultation", "cause", "injury_type",
	"body_part", "outcome", "lost_days", "description", "stabilization_steps", "referral_destination", "root_cause",
	"corrective_actions", "doshmis_status", "insurance_status", "doctor", "creation"]
SEVERITIES = ["Minor", "Moderate", "Severe", "Fatal"]


def _tidy(rows):
	"""Times come back from the database as durations (9:30:00): show them as HH:MM."""
	for r in rows:
		t = r.get("incident_time")
		if t:
			secs = int(t.total_seconds()) if hasattr(t, "total_seconds") else None
			r["incident_time"] = f"{secs // 3600:02d}:{secs % 3600 // 60:02d}" if secs is not None else str(t)[:5].rjust(5, "0")
	return rows


@frappe.whitelist()
def for_visit(visit):
	"""Events already recorded against this visit (shown in the consultation tab)."""
	require_any("consultation")
	return _tidy(frappe.get_all("Clinic Incident", filters={"visit": visit}, fields=LIST_FIELDS, order_by="creation desc"))


@frappe.whitelist()
def save(visit, data, name=None):
	"""Record (or update) an accident / incident from the consultation of a visit."""
	require("consultation")
	if isinstance(data, str):
		data = frappe.parse_json(data)
	v = frappe.db.get_value("Clinic Visit", visit, ["patient", "consultation"], as_dict=True)
	if not v:
		frappe.throw(_("Visit not found"))
	values = pick(data, FIELDS)
	for k in ("work_related", "accompanied_by_co"):
		if k in data:
			values[k] = cint(data[k])
	if "lost_days" in data:
		values["lost_days"] = cint(data["lost_days"])
	if name:
		doc = frappe.get_doc("Clinic Incident", name)
		if doc.visit != visit:
			frappe.throw(_("This record belongs to another visit"))
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Clinic Incident", "patient": v.patient, "visit": visit,
			"consultation": v.consultation, **values}).insert()
	return _tidy([doc.as_dict()])[0]


@frappe.whitelist()
def remove(name):
	require("consultation")
	doc = frappe.get_doc("Clinic Incident", name)
	if doc.status == "Closed":
		frappe.throw(_("A closed report cannot be deleted"))
	doc.delete()
	return True


def _range(month):
	try:
		first = getdate(f"{month}-01")
	except Exception:
		frappe.throw(_("Choose the month as YYYY-MM"))
	return first, get_last_day(first)


def _count(rows, key, order=None):
	out = {}
	for r in rows:
		k = r.get(key) or "Not stated"
		out[k] = out.get(k, 0) + 1
	items = [{"label": k, "count": v} for k, v in out.items()]
	if order:
		items.sort(key=lambda i: order.index(i["label"]) if i["label"] in order else 99)
	else:
		items.sort(key=lambda i: -i["count"])
	return items


def summarise(rows):
	return {
		"total": len(rows),
		"accidents": sum(1 for r in rows if r.report_type == "Accident"),
		"incidents": sum(1 for r in rows if r.report_type == "Incident"),
		"near_misses": sum(1 for r in rows if r.report_type == "Near Miss"),
		"serious": sum(1 for r in rows if r.severity in ("Severe", "Fatal")),
		"fatal": sum(1 for r in rows if r.severity == "Fatal"),
		"work_related": sum(1 for r in rows if cint(r.work_related)),
		"lost_days": sum(cint(r.lost_days) for r in rows),
		"referred": sum(1 for r in rows if r.outcome == "Referred out" or r.referral_destination),
		"open": sum(1 for r in rows if r.status != "Closed"),
		"statutory_pending": sum(1 for r in rows if r.doshmis_status in ("Pending", "In Progress")),
	}


def _rows(first, last, patient_type=None, employer=None, report_type=None):
	filters = {"incident_date": ["between", [first, last]]}
	if patient_type:
		filters["patient_type"] = patient_type
	if employer:
		filters["employer"] = employer
	if report_type:
		filters["report_type"] = report_type
	rows = frappe.get_all("Clinic Incident", filters=filters, fields=LIST_FIELDS, order_by="incident_date asc, creation asc")
	for r in rows:
		r.recorded_by = user_name(r.doctor)
	return _tidy(rows)


@frappe.whitelist()
def monthly(month=None, patient_type=None, employer=None, report_type=None):
	"""The monthly accidents and incidents report: figures, breakdowns, previous-month comparison and every record."""
	require_any("consultation", "triage")
	month = month or nowdate()[:7]
	first, last = _range(month)
	rows = _rows(first, last, patient_type, employer, report_type)
	pfirst = get_first_day(add_months(first, -1))
	prev = _rows(pfirst, get_last_day(pfirst), patient_type, employer, report_type)
	by_day = {}
	for r in rows:
		by_day[str(r.incident_date)] = by_day.get(str(r.incident_date), 0) + 1
	days = []
	d = first
	while d <= last:
		days.append({"day": str(d), "count": by_day.get(str(d), 0)})
		d = frappe.utils.add_days(d, 1)
	# the usual time of day events happen
	slots = {"Night (00–06)": 0, "Morning (06–12)": 0, "Afternoon (12–18)": 0, "Evening (18–24)": 0}
	for r in rows:
		if r.incident_time:
			h = int(str(r.incident_time).split(":")[0])
			slots[list(slots)[min(h // 6, 3)]] += 1
	return {
		"month": month, "period": first.strftime("%B %Y"), "from": str(first), "to": str(last),
		"summary": summarise(rows), "previous": summarise(prev), "previous_period": pfirst.strftime("%B %Y"),
		"by_severity": _count(rows, "severity", SEVERITIES),
		"by_type": _count(rows, "report_type"),
		"by_cause": _count(rows, "cause"),
		"by_injury": _count(rows, "injury_type")[:8],
		"by_body_part": _count(rows, "body_part")[:8],
		"by_department": _count(rows, "department"),
		"by_employer": _count([r for r in rows if r.employer], "employer"),
		"by_outcome": _count(rows, "outcome"),
		"by_time": [{"label": k, "count": v} for k, v in slots.items()],
		"by_day": days,
		"recurring": [r for r in _count(rows, "location") if r["label"] != "Not stated" and r["count"] > 1][:5],
		"rows": rows,
		"filters": {"patient_type": patient_type, "employer": employer, "report_type": report_type},
	}


@frappe.whitelist()
def report(month, patient_type=None, employer=None, report_type=None):
	"""Printable version: the monthly report together with the clinic letterhead."""
	data = monthly(month, patient_type, employer, report_type)
	data.update({"clinic": clinic_profile(), "printed_by": user_name(frappe.session.user), "printed_on": now_datetime()})
	return data


@frappe.whitelist()
def update_review(name, data):
	"""Root cause, corrective actions, statutory reporting and closing: done by the doctor or a manager."""
	require_any("consultation")
	if isinstance(data, str):
		data = frappe.parse_json(data)
	doc = frappe.get_doc("Clinic Incident", name)
	doc.update(pick(data, ["root_cause", "corrective_actions", "doshmis_status", "insurance_status", "status"]))
	doc.save()
	return doc.as_dict()
