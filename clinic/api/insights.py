"""Data behind the Clinic Insights page: reports and analytics over consultations, visits, sick-off, billing, lab and incidents.

One whitelisted call per view. Every view takes the same filters (year, month, from/to dates, department)."""

from collections import Counter, defaultdict
from datetime import date

import frappe
from frappe.utils import add_months, flt, get_first_day, get_last_day, getdate, nowdate

from clinic.api.common import require_any

VIEWS = ("overview", "health", "visits", "sickoff", "cost", "lab", "accidents")
MAX_ROWS = 15


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
		start=start, end=end, dept=(department or "").strip() or None,
		month_keys=[m.strftime("%Y-%m") for m in months],
		labels=[m.strftime("%b %Y") if len(months) > 12 or start.year != end.year else m.strftime("%b") for m in months],
		year=start.year,
	)


def _between(s):
	return [f"{s.start} 00:00:00", f"{s.end} 23:59:59"]


def _by_month(s, values):
	c = Counter(str(v)[:7] for v in values if v)
	return [c.get(k, 0) for k in s.month_keys]


def _pct(part, whole):
	return round(part * 100 / whole, 1) if whole else 0


def _dept_sql(s, column):
	return f" AND {column} = %(dept)s" if s.dept else ""


def _params(s, **extra):
	return {"start": f"{s.start} 00:00:00", "end": f"{s.end} 23:59:59", "dsd": str(s.start), "ded": str(s.end), "dept": s.dept, **extra}


def _consultations(s, fields):
	filters = {"consultation_date": ["between", _between(s)]}
	if s.dept:
		filters["department"] = s.dept
	return frappe.get_all("Clinic Consultation", filters=filters, fields=fields, order_by="consultation_date asc", limit_page_length=0)


def _overview(s):
	cons = _consultations(s, ["name", "consultation_date", "sick_leave_days", "patient", "work_related", "refer_out"])
	sick = [c for c in cons if (c.sick_leave_days or 0) > 0]
	visit_filters = {"visit_date": ["between", _between(s)], "status": ["!=", "Cancelled"]}
	if s.dept:
		visit_filters["department"] = s.dept
	visits = frappe.get_all("Clinic Visit", filters=visit_filters, fields=["visit_date"], limit_page_length=0)
	diag = frappe.db.sql(
		f"""SELECT d.diagnosis AS name, COUNT(DISTINCT d.parent) AS cases
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
		GROUP BY d.diagnosis ORDER BY cases DESC LIMIT 10""",
		_params(s), as_dict=True,
	)
	lab = frappe.db.sql(
		f"""SELECT status, COUNT(*) AS n FROM `tabClinic Lab Test` WHERE requested_on BETWEEN %(start)s AND %(end)s
		AND status != 'Cancelled' GROUP BY status""", _params(s), as_dict=True,
	)
	inc_filters = {"incident_date": ["between", [s.start, s.end]]}
	if s.dept:
		inc_filters["department"] = s.dept
	incidents = frappe.get_all("Clinic Incident", filters=inc_filters, fields=["incident_date", "report_type", "severity"], limit_page_length=0)
	cases = sum(d.cases for d in diag)
	return {
		"kpis": {
			"consultations": len(cons), "patients": len({c.patient for c in cons}), "visits": len(visits),
			"sick_offs": len(sick), "sick_days": sum(c.sick_leave_days for c in sick),
			"lab_tests": sum(r.n for r in lab), "lab_pending": sum(r.n for r in lab if r.status != "Resulted"),
			"incidents": len(incidents), "accidents": sum(1 for i in incidents if i.report_type == "Accident"),
			"referred": sum(1 for c in cons if c.refer_out), "work_related": sum(1 for c in cons if c.work_related),
		},
		"top_cases": [{"condition": r.name, "cases": r.cases, "share": _pct(r.cases, cases)} for r in diag],
		"by_month": {
			"labels": s.labels, "consultations": _by_month(s, (c.consultation_date for c in cons)),
			"visits": _by_month(s, (v.visit_date for v in visits)), "incidents": _by_month(s, (i.incident_date for i in incidents)),
		},
	}


def _health(s):
	rows = frappe.db.sql(
		f"""SELECT d.diagnosis AS condition_name, DATE_FORMAT(c.consultation_date, '%%Y-%%m') AS ym, COUNT(DISTINCT d.parent) AS n
		FROM `tabClinic Consultation Diagnosis` d JOIN `tabClinic Consultation` c ON c.name = d.parent
		WHERE c.consultation_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'c.department')}
		GROUP BY d.diagnosis, ym""", _params(s), as_dict=True,
	)
	table = defaultdict(lambda: Counter())
	for r in rows:
		table[r.condition_name][r.ym] += r.n
	out = []
	for name, c in table.items():
		cells = [c.get(k, 0) for k in s.month_keys]
		out.append({"condition": name, "cells": cells, "total": sum(cells)})
	out.sort(key=lambda r: -r["total"])
	grand = sum(r["total"] for r in out)
	months = max(len(s.month_keys), 1)
	for r in out:
		r["percent"] = _pct(r["total"], grand)
		r["average"] = round(r["total"] / months, 1)
	prev = frappe.db.sql(
		f"""SELECT DATE_FORMAT(c.consultation_date, '%%Y-%%m') AS ym, COUNT(DISTINCT c.name) AS n
		FROM `tabClinic Consultation` c WHERE YEAR(c.consultation_date) = %(y)s{_dept_sql(s, 'c.department')} GROUP BY ym""",
		{"y": s.year - 1, "dept": s.dept}, as_dict=True,
	)
	cur = frappe.db.sql(
		f"""SELECT DATE_FORMAT(c.consultation_date, '%%Y-%%m') AS ym, COUNT(DISTINCT c.name) AS n
		FROM `tabClinic Consultation` c WHERE YEAR(c.consultation_date) = %(y)s{_dept_sql(s, 'c.department')} GROUP BY ym""",
		{"y": s.year, "dept": s.dept}, as_dict=True,
	)
	month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
	pick = lambda rows, y: [next((r.n for r in rows if r.ym == f"{y}-{m:02d}"), 0) for m in range(1, 13)]  # noqa: E731
	return {
		"labels": s.labels, "rows": out[:60], "col_totals": [sum(r["cells"][i] for r in out) for i in range(len(s.month_keys))],
		"grand_total": grand, "conditions": len(out), "monthly_average": round(grand / months, 1),
		"months_reported": sum(1 for i in range(len(s.month_keys)) if any(r["cells"][i] for r in out)),
		"trend": {"labels": month_names, "years": [{"year": s.year - 1, "values": pick(prev, s.year - 1)}, {"year": s.year, "values": pick(cur, s.year)}]},
	}


def _visits(s):
	flt_dept = _dept_sql(s, "department")
	rows = frappe.db.sql(
		f"""SELECT visit_date, visit_source, patient_type, service_point, status FROM `tabClinic Visit`
		WHERE visit_date BETWEEN %(start)s AND %(end)s AND status != 'Cancelled'{flt_dept}""", _params(s), as_dict=True,
	)
	waits = frappe.db.sql(
		f"""SELECT TIMESTAMPDIFF(MINUTE, v.visit_date, t.triage_datetime) AS w FROM `tabClinic Visit` v JOIN `tabClinic Triage` t ON t.name = v.triage
		WHERE v.visit_date BETWEEN %(start)s AND %(end)s{_dept_sql(s, 'v.department')}""", _params(s), pluck="w",
	)
	waits = [w for w in waits if w is not None and w >= 0]
	hours = [0] * 24
	days = [0] * 7
	for r in rows:
		hours[r.visit_date.hour] += 1
		days[r.visit_date.weekday()] += 1
	count = lambda key: sorted(({"label": k or "Not stated", "value": v} for k, v in Counter(r[key] for r in rows).items()), key=lambda x: -x["value"])  # noqa: E731
	span = max((s.end - s.start).days + 1, 1)
	return {
		"kpis": {
			"visits": len(rows), "employees": sum(1 for r in rows if r.patient_type == "Employee"),
			"community": sum(1 for r in rows if r.patient_type == "Community Member"),
			"avg_per_day": round(len(rows) / span, 1), "avg_wait": round(sum(waits) / len(waits)) if waits else 0,
			"referred_in": sum(1 for r in rows if r.visit_source == "Referral In"),
		},
		"by_month": {"labels": s.labels, "visits": _by_month(s, (r.visit_date for r in rows))},
		"by_hour": {"labels": [f"{h:02d}:00" for h in range(5, 22)], "values": hours[5:22]},
		"by_weekday": {"labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "values": days},
		"by_source": count("visit_source"), "by_service": count("service_point"),
	}


def _sickoff(s):
	cons = [c for c in _consultations(s, ["name", "consultation_date", "sick_leave_days", "light_duty_days", "patient", "patient_name",
		"department", "refer_out", "referral_facility"]) if (c.sick_leave_days or 0) > 0 or (c.light_duty_days or 0) > 0]
	sick = [c for c in cons if (c.sick_leave_days or 0) > 0]
	per = defaultdict(lambda: {"episodes": 0, "days": 0})
	names = {}
	for c in sick:
		per[c.patient]["episodes"] += 1
		per[c.patient]["days"] += c.sick_leave_days
		names[c.patient] = (c.patient_name, c.department)
	staff = {p.name: p.staff_no for p in frappe.get_all("Clinic Patient", filters={"name": ["in", list(per) or [""]]}, fields=["name", "staff_no"])}
	top = sorted(per.items(), key=lambda kv: -kv[1]["days"])[:MAX_ROWS]
	buckets = [("1 day", 1, 1), ("2 days", 2, 2), ("3 days", 3, 3), ("4–5 days", 4, 5), ("6–7 days", 6, 7), ("8+ days", 8, 10**6)]
	fac = defaultdict(lambda: {"visits": 0, "patients": set(), "sick_days": 0})
	for c in cons:
		if c.refer_out and c.referral_facility:
			f = fac[c.referral_facility]
			f["visits"] += 1
			f["patients"].add(c.patient)
			f["sick_days"] += c.sick_leave_days or 0
	return {
		"kpis": {
			"records": len(sick), "employees": len(per), "days": sum(c.sick_leave_days for c in sick),
			"avg_days": round(sum(c.sick_leave_days for c in sick) / len(sick), 1) if sick else 0,
			"light_duty": sum(1 for c in cons if (c.light_duty_days or 0) > 0), "light_duty_days": sum(c.light_duty_days or 0 for c in cons),
			"referred_out": sum(1 for c in cons if c.refer_out),
		},
		"by_month": {"labels": s.labels, "records": _by_month(s, (c.consultation_date for c in sick)),
			"days": [sum(c.sick_leave_days for c in sick if str(c.consultation_date)[:7] == k) for k in s.month_keys]},
		"durations": {"labels": [b[0] for b in buckets], "values": [sum(1 for c in sick if lo <= c.sick_leave_days <= hi) for _, lo, hi in buckets]},
		"top_employees": [{"patient": p, "employee_name": names[p][0], "department": names[p][1], "staff_no": staff.get(p), **v} for p, v in top],
		"facilities": sorted(({"facility": k, "visits": v["visits"], "employees": len(v["patients"]), "sick_days": v["sick_days"]} for k, v in fac.items()), key=lambda r: -r["visits"]),
	}


def _cost(s):
	where = "b.bill_date BETWEEN %(dsd)s AND %(ded)s AND b.status != 'Cancelled'"
	dept = _dept_sql(s, "v.department")
	bills = frappe.db.sql(
		f"""SELECT b.name, b.patient, b.patient_name, b.employer, b.billing_mode, b.status, b.bill_date, b.total, b.consultation_total,
			b.procedure_total, b.lab_total, b.drug_total, v.department
		FROM `tabClinic Bill` b LEFT JOIN `tabClinic Visit` v ON v.name = b.visit WHERE {where}{dept}""", _params(s), as_dict=True,
	)
	by_type = {"Consultation": sum(flt(b.consultation_total) for b in bills), "Procedures": sum(flt(b.procedure_total) for b in bills),
		"Laboratory": sum(flt(b.lab_total) for b in bills), "Drugs": sum(flt(b.drug_total) for b in bills)}
	total = sum(flt(b.total) for b in bills)
	farms = defaultdict(lambda: {"bills": 0, "total": 0.0, "paid": 0.0})
	for b in bills:
		if b.employer:
			f = farms[b.employer]
			f["bills"] += 1
			f["total"] += flt(b.total)
			if b.status == "Paid":
				f["paid"] += flt(b.total)
	drugs = frappe.db.sql(
		f"""SELECT IFNULL(i.drug_name, i.drug) AS drug, SUM(i.dispensed_qty) AS qty, COUNT(DISTINCT d.name) AS dispensings
		FROM `tabClinic Dispensing Item` i JOIN `tabClinic Dispensing` d ON d.name = i.parent
		LEFT JOIN `tabClinic Visit` v ON v.name = d.visit
		WHERE d.docstatus = 1 AND d.dispensed_on BETWEEN %(start)s AND %(end)s AND i.dispensed_qty > 0{dept}
		GROUP BY i.drug, i.drug_name ORDER BY qty DESC LIMIT {MAX_ROWS}""", _params(s), as_dict=True,
	)
	per = defaultdict(lambda: {"visits": 0, "cost": 0.0, "name": "", "dept": ""})
	for b in bills:
		p = per[b.patient]
		p["visits"] += 1
		p["cost"] += flt(b.total)
		p["name"], p["dept"] = b.patient_name, b.department
	top = sorted(per.items(), key=lambda kv: -kv[1]["cost"])[:MAX_ROWS]
	paid = sum(flt(b.total) for b in bills if b.status == "Paid")
	return {
		"kpis": {
			"bills": len(bills), "total": total, "avg": round(total / len(bills)) if bills else 0, "paid": paid,
			"invoiced": sum(flt(b.total) for b in bills if b.billing_mode == "Invoice"), "outstanding": total - paid,
		},
		"by_month": {"labels": s.labels, "total": [round(sum(flt(b.total) for b in bills if str(b.bill_date)[:7] == k)) for k in s.month_keys]},
		"by_type": [{"label": k, "value": v, "percent": _pct(v, total)} for k, v in by_type.items()],
		"farms": sorted(({"farm": k, **v} for k, v in farms.items()), key=lambda r: -r["total"]),
		"top_drugs": drugs,
		"top_patients": [{"patient": p, "employee_name": v["name"], "department": v["dept"], "visits": v["visits"], "cost": v["cost"]} for p, v in top],
	}


def _lab(s):
	tests = frappe.db.sql(
		"""SELECT test_type, status, interpretation, performed_where, urgency, requested_on, resulted_on, patient_name
		FROM `tabClinic Lab Test` WHERE requested_on BETWEEN %(start)s AND %(end)s AND status != 'Cancelled'""", _params(s), as_dict=True,
	)
	by = defaultdict(lambda: Counter())
	for t in tests:
		by[t.test_type]["total"] += 1
		by[t.test_type][t.interpretation or t.status] += 1
	turn = [int((t.resulted_on - t.requested_on).total_seconds() // 60) for t in tests if t.resulted_on and t.requested_on and t.resulted_on >= t.requested_on]
	outcomes = Counter(t.interpretation for t in tests if t.interpretation)
	return {
		"kpis": {
			"requested": len(tests), "resulted": sum(1 for t in tests if t.status == "Resulted"), "pending": sum(1 for t in tests if t.status != "Resulted"),
			"urgent": sum(1 for t in tests if t.urgency == "Urgent"), "external": sum(1 for t in tests if t.performed_where == "External"),
			"positive": outcomes.get("Positive", 0) + outcomes.get("Abnormal", 0),
		},
		"by_month": {"labels": s.labels, "requests": _by_month(s, (t.requested_on for t in tests))},
		"outcomes": [{"label": k, "value": v} for k, v in outcomes.most_common()],
		"avg_turnaround": round(sum(turn) / len(turn)) if turn else None,
		"by_type": [{"test": k, "total": v["total"], "positive": v.get("Positive", 0) + v.get("Abnormal", 0), "negative": v.get("Negative", 0) + v.get("Normal", 0)}
			for k, v in sorted(by.items(), key=lambda kv: -kv[1]["total"])[:MAX_ROWS * 2]],
		"flagged": [{"at": str(t.resulted_on or t.requested_on), "patient_name": t.patient_name, "test": t.test_type, "flag": t.interpretation}
			for t in tests if t.interpretation in ("Positive", "Abnormal")][:40],
	}


def _accidents(s):
	filters = {"incident_date": ["between", [s.start, s.end]]}
	if s.dept:
		filters["department"] = s.dept
	rows = frappe.get_all("Clinic Incident", filters=filters, order_by="incident_date desc", limit_page_length=0,
		fields=["name", "incident_date", "report_type", "severity", "patient_name", "department", "employer", "cause", "injury_type", "work_related",
			"outcome", "lost_days", "description", "status", "referral_destination"])
	count = lambda key: sorted(({"label": k or "Not stated", "value": v} for k, v in Counter(r[key] for r in rows).items()), key=lambda x: -x["value"])  # noqa: E731
	return {
		"kpis": {
			"records": len(rows), "accidents": sum(1 for r in rows if r.report_type == "Accident"),
			"serious": sum(1 for r in rows if r.severity in ("Severe", "Fatal")), "work_related": sum(1 for r in rows if r.work_related),
			"lost_days": sum(r.lost_days or 0 for r in rows), "hospital": sum(1 for r in rows if r.outcome in ("Referred out", "Admitted") or r.referral_destination),
		},
		"by_month": {"labels": s.labels, "incidents": _by_month(s, (r.incident_date for r in rows))},
		"by_severity": count("severity"), "by_cause": count("cause")[:8], "by_department": count("department")[:8],
		"records": [{**r, "at": str(r.incident_date)} for r in rows][:200],
	}


BUILDERS = {"overview": _overview, "health": _health, "visits": _visits, "sickoff": _sickoff, "cost": _cost, "lab": _lab, "accidents": _accidents}


def _departments():
	return frappe.get_all("Clinic Consultation", filters={"department": ["is", "set"]}, pluck="department", distinct=True, order_by="department asc")


@frappe.whitelist()
def dashboard(view="overview", year=None, month=None, from_date=None, to_date=None, department=None):
	require_any("consultation")
	if view not in BUILDERS:
		frappe.throw("Unknown view")
	s = _scope(year, month, from_date, to_date, department)
	years = frappe.db.sql("SELECT DISTINCT YEAR(consultation_date) FROM `tabClinic Consultation` ORDER BY 1 DESC", pluck=True)
	this = getdate(nowdate()).year
	return {
		"view": view, "data": BUILDERS[view](s),
		"meta": {"years": sorted({*years, this}, reverse=True), "departments": _departments(),
			"period": f"{s.start} → {s.end}"},
	}
