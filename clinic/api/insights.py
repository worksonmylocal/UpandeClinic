"""Data behind the Clinic Insights page: reports and analytics over consultations, visits, dispensing and incidents.

One whitelisted call per view. Every view takes the same filters (year, month, from/to dates, department)."""

from collections import Counter, defaultdict
from datetime import date

import frappe
from frappe.utils import add_months, flt, get_first_day, get_last_day, getdate, nowdate

from clinic import attendance as bio
from clinic.api import attendance as att
from clinic.api.common import require

VIEWS = ("overview", "health", "visits", "sickoff", "cost", "investigations", "accidents")
MAX_ROWS = 15


# ------------------------------------------------------------------ scope
def _scope(year=None, month=None, from_date=None, to_date=None, department=None):
	"""The period and department every figure on the page is limited to."""
	today = getdate(nowdate())
	if from_date or to_date:
		start, end = getdate(from_date or to_date), getdate(to_date or from_date)
		if end < start:
			start, end = end, start
	else:
		year = int(year or today.year)
		if month:
			start = date(year, int(month), 1)
			end = get_last_day(start)
		else:
			start, end = date(year, 1, 1), date(year, 12, 31)
	months, cur = [], get_first_day(start)
	while cur <= end and len(months) < 36:
		months.append(cur)
		cur = add_months(cur, 1)
	return frappe._dict(
		start=start,
		end=end,
		dept=(department or "").strip() or None,
		month_keys=[m.strftime("%Y-%m") for m in months],
		labels=[m.strftime("%b %Y") if len(months) > 12 or start.year != end.year else m.strftime("%b") for m in months],
		year=start.year,
	)


def _between(s):
	return [f"{s.start} 00:00:00", f"{s.end} 23:59:59"]


def _by_month(s, values):
	"""values: iterable of dates/datetimes -> counts aligned with the scope's months."""
	c = Counter(str(v)[:7] for v in values if v)
	return [c.get(k, 0) for k in s.month_keys]


def _pct(part, whole):
	return round(part * 100 / whole, 1) if whole else 0


def _consultations(s, fields):
	filters = {"consultation_date": ["between", _between(s)]}
	if s.dept:
		filters["department"] = s.dept
	return frappe.get_all("Clinic Consultation", filters=filters, fields=fields, order_by="consultation_date asc", limit_page_length=0)


def _dept_sql(s, column):
	return f" AND {column} = %(dept)s" if s.dept else ""


def _params(s, **extra):
	return {"start": f"{s.start} 00:00:00", "end": f"{s.end} 23:59:59", "dept": s.dept, **extra}


def _staff_nos(patients):
	if not patients:
		return {}
	return {
		p.name: p.staff_no
		for p in frappe.get_all("Clinic Patient", filters={"name": ["in", list(set(patients))]}, fields=["name", "staff_no"])
	}


# ------------------------------------------------------------------ biometric (shared with the overview)
def _bio_sessions(s):
	if not bio.has_checkin():
		return None, "Employee Checkin (HRMS) is not on this site."
	devices = bio.device_ids()
	if not devices:
		return None, "No clinic biometric device is set. Add its ID in Clinic Settings."
	punches = att._punches(devices, s.start, s.end)
	people = att._employees({p.employee for p in punches})
	if s.dept:
		punches = [p for p in punches if people.get(p.employee) and people[p.employee].department == s.dept]
	return {"punches": punches, "sessions": att._sessions(punches), "people": people}, None


# ------------------------------------------------------------------ views
def _overview(s):
	cons = _consultations(s, ["name", "consultation_date", "sick_leave_days", "patient"])
	sick = [c for c in cons if (c.sick_leave_days or 0) > 0]
	diag = frappe.db.sql(
		f"""SELECT d.diagnosis AS name, COUNT(DISTINCT d.parent) AS cases
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
		GROUP BY d.diagnosis ORDER BY cases DESC LIMIT 10""",
		_params(s),
		as_dict=True,
	)
	inv = frappe.db.sql(
		f"""SELECT i.result_status AS status, COUNT(*) AS n FROM `tabClinic Investigation Request` i
		JOIN `tabClinic Consultation` c ON c.name = i.parent
		WHERE i.parenttype = 'Clinic Consultation' AND c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
		GROUP BY i.result_status""",
		_params(s),
		as_dict=True,
	)
	incidents = frappe.get_all(
		"Clinic Incident",
		filters={"incident_date": ["between", [s.start, s.end]], **({"department": s.dept} if s.dept else {})},
		fields=["incident_date", "report_type", "severity"],
		limit_page_length=0,
	)
	field = frappe.get_all(
		"Clinic First Aid Case",
		filters={"case_datetime": ["between", _between(s)], **({"department": s.dept} if s.dept else {})},
		fields=["case_datetime"],
		limit_page_length=0,
	)
	data, _ = _bio_sessions(s)
	sessions = data["sessions"] if data else []
	cases = sum(d.cases for d in diag)
	waiting = sum(r.n for r in inv if r.status == "Awaiting Results")
	return {
		"kpis": {
			"consultations": len(cons),
			"patients": len({c.patient for c in cons}),
			"clinic_visits": len(sessions) if data else None,
			"sick_offs": len(sick),
			"sick_days": sum(c.sick_leave_days for c in sick),
			"investigations": sum(r.n for r in inv),
			"awaiting_results": waiting,
			"incidents": len(incidents),
			"accidents": sum(1 for i in incidents if i.report_type == "Accident"),
			"first_aid": len(field),
		},
		"top_cases": [{"condition": r.name, "cases": r.cases, "share": _pct(r.cases, cases)} for r in diag],
		"by_month": {
			"labels": s.labels,
			"consultations": _by_month(s, (c.consultation_date for c in cons)),
			"visits": _by_month(s, (x["time_in"] for x in sessions)) if data else None,
			"incidents": _by_month(s, [i.incident_date for i in incidents] + [f.case_datetime for f in field]),
		},
	}


def _health(s):
	rows = frappe.db.sql(
		f"""SELECT DISTINCT d.parent, d.diagnosis AS name, c.consultation_date AS at
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}""",
		_params(s),
		as_dict=True,
	)
	count, total = defaultdict(Counter), Counter()
	for r in rows:
		count[r.name][str(r.at)[:7]] += 1
		total[r.name] += 1
	grand, n_months = sum(total.values()), max(len(s.month_keys), 1)
	table = [
		{
			"condition": name,
			"cells": [count[name].get(k, 0) for k in s.month_keys],
			"total": t,
			"percent": _pct(t, grand),
			"average": round(t / n_months, 1),
		}
		for name, t in total.most_common()
	]
	# Monthly encounters by year, for the years the clinic has data for (the period filter does not apply)
	trend = frappe.db.sql(
		f"""SELECT YEAR(c.consultation_date) AS y, MONTH(c.consultation_date) AS m,
			COUNT(DISTINCT CONCAT(d.parent, '|', d.diagnosis)) AS n
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE 1 = 1{_dept_sql(s, 'c.department')} GROUP BY y, m""",
		{"dept": s.dept},
		as_dict=True,
	)
	years = sorted({t.y for t in trend})[-3:]
	return {
		"labels": s.labels,
		"rows": table,
		"col_totals": [sum(r["cells"][i] for r in table) for i in range(len(s.month_keys))],
		"grand_total": grand,
		"conditions": len(table),
		"monthly_average": round(grand / n_months, 1),
		"months_reported": sum(1 for i in range(len(s.month_keys)) if any(r["cells"][i] for r in table)),
		"trend": {
			"labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
			"years": [{"year": y, "values": [next((t.n for t in trend if t.y == y and t.m == m), 0) for m in range(1, 13)]} for y in years],
		},
	}


def _visits(s):
	data, reason = _bio_sessions(s)
	if not data:
		return {"configured": False, "reason": reason}
	punches, sessions, people = data["punches"], data["sessions"], data["people"]
	days = {str(p.time)[:10] for p in punches}
	done = [x["minutes"] for x in sessions if x["status"] == "Completed"]
	hour_in, hour_out = [0] * 24, [0] * 24
	for p in punches:
		(hour_in if p.log_type == "IN" else hour_out)[int(str(p.time)[11:13])] += 1
	people_rows = {}
	for x in sessions:
		r = people_rows.setdefault(
			x["employee"],
			{"employee": x["employee"], "employee_name": x["employee_name"], "department": getattr(people.get(x["employee"]), "department", None),
			 "visits": 0, "first_in": None, "last_out": None, "minutes": 0},
		)
		r["visits"] += 1
		r["minutes"] += x["minutes"] or 0 if x["status"] == "Completed" else 0
		if x["time_in"] and (not r["first_in"] or str(x["time_in"]) < str(r["first_in"])):
			r["first_in"] = x["time_in"]
		if x["time_out"] and (not r["last_out"] or str(x["time_out"]) > str(r["last_out"])):
			r["last_out"] = x["time_out"]
	top = sorted(people_rows.values(), key=lambda r: (-r["visits"], -r["minutes"]))[:MAX_ROWS]
	return {
		"configured": True,
		"kpis": {
			"punches": len(punches),
			"employees": len(people_rows),
			"visits": len(sessions),
			"days": len(days),
			"avg_per_day": round(len(sessions) / len(days), 1) if days else 0,
			"avg_minutes": round(sum(done) / len(done)) if done else 0,
			"total_minutes": sum(done),
			"no_checkout": sum(1 for x in sessions if x["status"] == "No check-out"),
		},
		"by_month": {"labels": s.labels, "visits": _by_month(s, (x["time_in"] for x in sessions))},
		"by_hour": {"labels": [f"{h:02d}:00" for h in range(24)], "in": hour_in, "out": hour_out},
		"top_employees": top,
	}


def _sickoff(s):
	cons = _consultations(
		s, ["name", "consultation_date", "patient", "patient_name", "department", "sick_leave_days", "light_duty_days", "refer_out", "referral_facility"]
	)
	sick = [c for c in cons if (c.sick_leave_days or 0) > 0]
	light = [c for c in cons if (c.light_duty_days or 0) > 0]
	staff = _staff_nos([c.patient for c in sick])
	per = {}
	for c in sick:
		r = per.setdefault(c.patient, {"patient": c.patient, "employee_name": c.patient_name, "staff_no": staff.get(c.patient), "department": c.department, "episodes": 0, "days": 0})
		r["episodes"] += 1
		r["days"] += c.sick_leave_days
	buckets = [("1 day", lambda d: d == 1), ("2 days", lambda d: d == 2), ("3 days", lambda d: d == 3), ("4–7 days", lambda d: 4 <= d <= 7), ("8+ days", lambda d: d >= 8)]
	external = {}
	for c in cons:
		if c.refer_out and c.referral_facility:
			r = external.setdefault(c.referral_facility, {"facility": c.referral_facility, "visits": 0, "patients": set(), "sick_days": 0})
			r["visits"] += 1
			r["patients"].add(c.patient)
			r["sick_days"] += c.sick_leave_days or 0
	days = sum(c.sick_leave_days for c in sick)
	return {
		"kpis": {
			"records": len(sick),
			"employees": len(per),
			"days": days,
			"avg_days": round(days / len(sick), 1) if sick else 0,
			"light_duty": len(light),
			"light_duty_days": sum(c.light_duty_days for c in light),
			"referred_out": sum(1 for c in cons if c.refer_out),
		},
		"by_month": {"labels": s.labels, "records": _by_month(s, (c.consultation_date for c in sick)), "days": [
			sum(c.sick_leave_days for c in sick if str(c.consultation_date)[:7] == k) for k in s.month_keys]},
		"durations": {"labels": [b[0] for b in buckets], "values": [sum(1 for c in sick if b[1](c.sick_leave_days)) for b in buckets]},
		"top_employees": sorted(per.values(), key=lambda r: (-r["days"], -r["episodes"]))[:MAX_ROWS],
		"facilities": sorted(
			[{"facility": r["facility"], "visits": r["visits"], "employees": len(r["patients"]), "sick_days": r["sick_days"]} for r in external.values()],
			key=lambda r: -r["visits"],
		),
	}


def _item_rates(items):
	if not items:
		return {}
	rates = {}
	for i in frappe.get_all(
		"Item", filters={"name": ["in", list(items)]}, fields=["name", "item_group", "valuation_rate", "last_purchase_rate", "standard_rate"]
	):
		rates[i.name] = (flt(i.valuation_rate) or flt(i.last_purchase_rate) or flt(i.standard_rate), i.item_group)
	return rates


def _cost(s):
	rows = frappe.db.sql(
		f"""SELECT p.name AS dispensing, p.dispensed_on AS at, p.patient, p.patient_name, cp.department, cp.staff_no,
			i.drug, i.drug_name, i.dispensed_qty AS qty
		FROM `tabClinic Dispensing` p JOIN `tabClinic Dispensing Item` i ON i.parent = p.name
		LEFT JOIN `tabClinic Patient` cp ON cp.name = p.patient
		WHERE p.docstatus = 1 AND p.dispensed_on BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'cp.department')}""",
		_params(s),
		as_dict=True,
	)
	rates = _item_rates({r.drug for r in rows})
	for r in rows:
		rate, group = rates.get(r.drug, (0, None))
		r.cost, r.group = flt(r.qty) * rate, group or "Other"
	visits = {r.dispensing for r in rows}
	people = {r.patient for r in rows}
	total = sum(r.cost for r in rows)
	by_group, by_drug, by_person = defaultdict(lambda: [0, 0.0]), defaultdict(lambda: [0, 0.0]), {}
	for r in rows:
		by_group[r.group][0] += 1
		by_group[r.group][1] += r.cost
		by_drug[r.drug_name or r.drug][0] += flt(r.qty)
		by_drug[r.drug_name or r.drug][1] += r.cost
		p = by_person.setdefault(r.patient, {"patient": r.patient, "employee_name": r.patient_name, "staff_no": r.staff_no, "department": r.department, "visits": set(), "cost": 0.0, "last": None})
		p["visits"].add(r.dispensing)
		p["cost"] += r.cost
		p["last"] = max(str(p["last"] or ""), str(r.at))
	return {
		"kpis": {
			"visits": len(visits),
			"employees": len(people),
			"cost": round(total, 2),
			"avg_cost": round(total / len(visits), 2) if visits else 0,
			"cost_per_employee": round(total / len(people), 2) if people else 0,
			"unpriced": sum(1 for d in {r.drug for r in rows} if not rates.get(d, (0,))[0]),
		},
		"by_month": {"labels": s.labels, "visits": [len({r.dispensing for r in rows if str(r.at)[:7] == k}) for k in s.month_keys], "cost": [round(sum(r.cost for r in rows if str(r.at)[:7] == k), 2) for k in s.month_keys]},
		"by_group": sorted(
			[{"group": g, "items": v[0], "cost": round(v[1], 2), "percent": _pct(v[1], total)} for g, v in by_group.items()], key=lambda r: -r["cost"]
		),
		"top_drugs": sorted([{"drug": d, "qty": round(v[0], 2), "cost": round(v[1], 2)} for d, v in by_drug.items()], key=lambda r: (-r["cost"], -r["qty"]))[:MAX_ROWS],
		"top_employees": sorted(
			[{**p, "visits": len(p["visits"]), "cost": round(p["cost"], 2)} for p in by_person.values()], key=lambda r: (-r["cost"], -r["visits"])
		)[:MAX_ROWS],
	}


def _investigations(s):
	rows = frappe.db.sql(
		f"""SELECT i.investigation, i.category, i.urgency, i.result_status AS status, i.result_flag AS flag, i.result_date,
			i.result_impression, i.result_findings, c.consultation_date AS at, c.patient_name, c.department, c.name AS consultation
		FROM `tabClinic Investigation Request` i JOIN `tabClinic Consultation` c ON c.name = i.parent
		WHERE i.parenttype = 'Clinic Consultation' AND c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
		ORDER BY c.consultation_date DESC""",
		_params(s),
		as_dict=True,
	)
	statuses = ["Awaiting Results", "Results Received", "Reviewed"]
	by_type = defaultdict(Counter)
	for r in rows:
		by_type[r.investigation][r.status or "Awaiting Results"] += 1
	flags = Counter(r.flag for r in rows if r.flag)
	cats = Counter(r.category or "Other" for r in rows)
	return {
		"statuses": statuses,
		"kpis": {
			"requested": len(rows),
			"awaiting": sum(1 for r in rows if (r.status or "Awaiting Results") == "Awaiting Results"),
			"received": sum(1 for r in rows if r.status == "Results Received"),
			"reviewed": sum(1 for r in rows if r.status == "Reviewed"),
			"abnormal": flags.get("Abnormal", 0),
			"critical": flags.get("Critical", 0),
			"urgent": sum(1 for r in rows if r.urgency and r.urgency != "Routine"),
		},
		"by_month": {"labels": s.labels, "requests": _by_month(s, (r.at for r in rows))},
		"by_type": sorted(
			[{"investigation": k, **{st: v.get(st, 0) for st in statuses}, "total": sum(v.values())} for k, v in by_type.items()], key=lambda r: -r["total"]
		),
		"by_category": [{"label": k, "value": v} for k, v in cats.most_common(10)],
		"flags": [{"label": k, "value": flags.get(k, 0)} for k in ("Normal", "Abnormal", "Critical")],
		"flagged": [
			{"at": r.at, "patient_name": r.patient_name, "department": r.department, "investigation": r.investigation, "flag": r.flag, "impression": r.result_impression or r.result_findings}
			for r in rows
			if r.flag in ("Abnormal", "Critical")
		][:MAX_ROWS],
	}


def _accidents(s):
	dept = {"department": s.dept} if s.dept else {}
	incidents = frappe.get_all(
		"Clinic Incident",
		filters={"incident_date": ["between", [s.start, s.end]], **dept},
		fields=["name", "incident_date", "report_type", "severity", "employee_name", "department", "injury_type", "work_related", "description"],
		order_by="incident_date desc",
		limit_page_length=0,
	)
	cases = frappe.get_all(
		"Clinic First Aid Case",
		filters={"case_datetime": ["between", _between(s)], **dept},
		fields=["name", "case_datetime", "nature", "outcome", "patient_name", "department", "first_aider_name", "location"],
		order_by="case_datetime desc",
		limit_page_length=0,
	)
	records = [
		{"at": str(i.incident_date), "source": i.report_type, "employee_name": i.employee_name, "department": i.department,
		 "what": i.injury_type or (i.description or "")[:60], "result": i.severity, "attended_by": None}
		for i in incidents
	] + [
		{"at": str(c.case_datetime)[:16], "source": "First aid", "employee_name": c.patient_name, "department": c.department,
		 "what": c.nature, "result": c.outcome, "attended_by": c.first_aider_name}
		for c in cases
	]
	records.sort(key=lambda r: r["at"], reverse=True)
	depts = Counter(r["department"] or "Unspecified" for r in records)
	return {
		"kpis": {
			"records": len(records),
			"accidents": sum(1 for i in incidents if i.report_type == "Accident"),
			"serious": sum(1 for i in incidents if i.severity in ("Severe", "Fatal")),
			"work_related": sum(1 for i in incidents if i.work_related),
			"first_aid": len(cases),
			"hospital": sum(1 for c in cases if c.outcome == "Referred to hospital"),
		},
		"by_month": {"labels": s.labels, "incidents": _by_month(s, (i.incident_date for i in incidents)), "first_aid": _by_month(s, (c.case_datetime for c in cases))},
		"by_nature": [{"label": k, "value": v} for k, v in Counter(c.nature or "Other" for c in cases).most_common(10)],
		"by_severity": [{"label": k, "value": v} for k, v in Counter(i.severity or "Unspecified" for i in incidents).most_common()],
		"by_department": [{"label": k, "value": v} for k, v in depts.most_common(10)],
		"records": records[: MAX_ROWS * 2],
	}


_BUILDERS = {
	"overview": _overview,
	"health": _health,
	"visits": _visits,
	"sickoff": _sickoff,
	"cost": _cost,
	"investigations": _investigations,
	"accidents": _accidents,
}


def _departments():
	rows = frappe.db.sql("SELECT DISTINCT department FROM `tabClinic Consultation` WHERE IFNULL(department, '') != '' ORDER BY department", pluck=True)
	return rows


@frappe.whitelist()
def dashboard(view="overview", year=None, month=None, from_date=None, to_date=None, department=None):
	require("insights")
	if view not in _BUILDERS:
		frappe.throw(f"Unknown view {view}")
	s = _scope(year, month, from_date, to_date, department)
	years = frappe.db.sql("SELECT DISTINCT YEAR(consultation_date) FROM `tabClinic Consultation` WHERE consultation_date IS NOT NULL ORDER BY 1 DESC", pluck=True)
	this_year = getdate(nowdate()).year
	return {
		"view": view,
		"meta": {
			"years": sorted(set(years) | {this_year}, reverse=True),
			"departments": _departments(),
			"range": {"from": str(s.start), "to": str(s.end)},
		},
		"data": _BUILDERS[view](s),
	}


@frappe.whitelist()
def detail(kind, value, year=None, month=None, from_date=None, to_date=None, department=None):
	"""The patients behind a figure: a condition, an employee's sick-off, or an employee's/drug's dispensing."""
	require("insights")
	s = _scope(year, month, from_date, to_date, department)
	if kind == "condition":
		rows = frappe.db.sql(
			f"""SELECT DISTINCT c.name AS ref, c.consultation_date AS at, c.patient_name, c.department, c.doctor AS note, cp.staff_no
			FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
			LEFT JOIN `tabClinic Patient` cp ON cp.name = c.patient
			WHERE d.diagnosis = %(value)s AND c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
			ORDER BY c.consultation_date DESC LIMIT 200""",
			_params(s, value=value),
			as_dict=True,
		)
	elif kind == "sick_employee":
		rows = frappe.db.sql(
			f"""SELECT c.name AS ref, c.consultation_date AS at, c.patient_name, c.department,
				CONCAT(c.sick_leave_days, ' sick day(s)') AS note, cp.staff_no
			FROM `tabClinic Consultation` c LEFT JOIN `tabClinic Patient` cp ON cp.name = c.patient
			WHERE c.patient = %(value)s AND c.sick_leave_days > 0 AND c.consultation_date BETWEEN %(start)s AND %(end)s
			ORDER BY c.consultation_date DESC LIMIT 200""",
			_params(s, value=value),
			as_dict=True,
		)
	elif kind in ("cost_employee", "drug"):
		match = "p.patient = %(value)s" if kind == "cost_employee" else "(i.drug_name = %(value)s OR i.drug = %(value)s)"
		rows = frappe.db.sql(
			f"""SELECT p.name AS ref, p.dispensed_on AS at, p.patient_name, cp.department, cp.staff_no,
				CONCAT(i.drug_name, ' × ', i.dispensed_qty) AS note
			FROM `tabClinic Dispensing` p JOIN `tabClinic Dispensing Item` i ON i.parent = p.name
			LEFT JOIN `tabClinic Patient` cp ON cp.name = p.patient
			WHERE p.docstatus = 1 AND {match} AND p.dispensed_on BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'cp.department')}
			ORDER BY p.dispensed_on DESC LIMIT 200""",
			_params(s, value=value),
			as_dict=True,
		)
	else:
		frappe.throw(f"Unknown detail {kind}")
	return rows
