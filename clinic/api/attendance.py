"""Data behind the clinic Attendance page: the clinic biometric device's punches, paired into visits."""

import frappe
from frappe.utils import add_days, get_datetime, getdate, nowdate

from clinic.api.common import minutes_since, require
from clinic.attendance import IN_LABEL, device_ids, has_checkin, sequence, staff_ids

MAX_DAYS = 62


def _punches(devices, start, end, q=None):
	rows = frappe.get_all(  # reads regardless of HR permissions: only these few fields leave the server
		"Employee Checkin",
		filters={"device_id": ["in", devices], "time": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]},
		fields=["name", "employee", "employee_name", "time", "device_id"],
		order_by="employee asc, time asc, creation asc",
		limit_page_length=0,
	)
	staff = staff_ids()  # clinic staff are not patients: their touches belong to HR attendance
	if staff:
		rows = [r for r in rows if r.employee not in staff]
	if q:
		q = q.lower()
		rows = [r for r in rows if q in (r.employee_name or "").lower() or q in (r.employee or "").lower()]
	days = {}
	for r in rows:
		days.setdefault((r.employee, str(r.time)[:10]), []).append(r)
	clean = []
	for group in days.values():
		for r, (label, dup) in zip(group, sequence([g.time for g in group])):
			if not dup:  # a re-sent touch is not a second touch
				r["label"] = label
				r["log_type"] = "IN" if label == IN_LABEL else "OUT"
				clean.append(r)
	return clean


def _sessions(punches):
	"""One line per visit: touch 1 is time in, touch 2 is time out, touch 3 starts a fresh visit, and so on."""
	by_day = {}
	for p in punches:  # ordered by employee, then time
		by_day.setdefault((p.employee, str(p.time)[:10]), []).append(p)
	out, today = [], nowdate()
	for (employee, day), touches in by_day.items():
		for i in range(0, len(touches), 2):
			start = touches[i].time
			end = touches[i + 1].time if i + 1 < len(touches) else None
			s = {"employee": employee, "employee_name": touches[i].employee_name, "time_in": start, "time_out": end, "date": day}
			if end:
				s["minutes"] = max(int((get_datetime(end) - get_datetime(start)).total_seconds() // 60), 0)
				s["status"] = "Completed"
			else:
				s["minutes"] = minutes_since(start) if day == today else None
				s["status"] = "In clinic" if day == today else "No check-out"
			out.append(s)
	out.sort(key=lambda s: str(s["time_in"]), reverse=True)
	return out


def _employees(ids):
	if not ids:
		return {}
	return {
		e.name: e
		for e in frappe.get_all(
			"Employee",
			filters={"name": ["in", list(ids)]},
			fields=["name", "employee_name", "department", "designation", "cell_number", "image", "status"],
		)
	}


@frappe.whitelist()
def dashboard(from_date=None, to_date=None, q=None):
	require("attendance")
	devices = device_ids()
	if not has_checkin():
		return {"configured": False, "reason": "Employee Checkin (HRMS) is not on this site."}
	if not devices:
		return {"configured": False, "reason": "No clinic biometric device is set. Add its ID in Clinic Settings."}
	start = getdate(from_date or nowdate())
	end = getdate(to_date or start)
	if end < start:
		start, end = end, start
	if (end - start).days > MAX_DAYS:
		start = add_days(end, -MAX_DAYS)

	punches = _punches(devices, start, end, (q or "").strip())
	sessions = _sessions(punches)
	people = _employees({p.employee for p in punches})
	for s in sessions:
		e = people.get(s["employee"])
		s["department"] = e.department if e else None
		s["designation"] = e.designation if e else None
		s["phone"] = e.cell_number if e else None
		s["image"] = e.image if e else None
	for p in punches:
		e = people.get(p.employee)
		p["department"] = e.department if e else None
		p["designation"] = e.designation if e else None
	done = [s["minutes"] for s in sessions if s["status"] == "Completed"]
	return {
		"configured": True,
		"devices": devices,
		"range": {"from": str(start), "to": str(end)},
		"kpis": {
			"in_now": sum(1 for s in sessions if s["status"] == "In clinic"),
			"visits": len(sessions),
			"people": len({s["employee"] for s in sessions}),
			"avg_minutes": round(sum(done) / len(done)) if done else 0,
			"no_checkout": sum(1 for s in sessions if s["status"] == "No check-out"),
		},
		"sessions": sessions,
		"punches": sorted(punches, key=lambda p: str(p.time), reverse=True),
	}
