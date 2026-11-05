"""Data behind the clinic Attendance page: the clinic biometric device's punches, paired into visits."""

import frappe
from frappe.utils import add_days, get_datetime, getdate, nowdate

from clinic.api.common import minutes_since, require
from clinic.attendance import device_ids, has_checkin, label_for

MAX_DAYS = 62
DUPLICATE_SECONDS = 120  # a device that re-sends a punch must not count twice


def _punches(devices, start, end, q=None):
	rows = frappe.get_all(  # reads regardless of HR permissions: only these few fields leave the server
		"Employee Checkin",
		filters={"device_id": ["in", devices], "time": ["between", [f"{start} 00:00:00", f"{end} 23:59:59"]]},
		fields=["name", "employee", "employee_name", "log_type", "time", "device_id"],
		order_by="employee asc, time asc",
		limit_page_length=0,
	)
	if q:
		q = q.lower()
		rows = [r for r in rows if q in (r.employee_name or "").lower() or q in (r.employee or "").lower()]
	clean, last = [], {}
	for r in rows:
		key = (r.employee, r.log_type)
		prev = last.get(key)
		if prev and (get_datetime(r.time) - get_datetime(prev)).total_seconds() < DUPLICATE_SECONDS:
			continue
		last[key] = r.time
		r["label"] = label_for(r.log_type)
		clean.append(r)
	return clean


def _sessions(punches):
	"""Pair each check-in with the next check-out of the same employee."""
	out, open_ = [], {}
	for p in punches:  # ordered by employee, then time
		cur = open_.get(p.employee)
		if p.log_type == "IN":
			if cur:  # a second check-in without a check-out in between
				out.append(cur)
			open_[p.employee] = {"employee": p.employee, "employee_name": p.employee_name, "time_in": p.time, "time_out": None}
		else:
			if cur:
				cur["time_out"] = p.time
				out.append(cur)
				open_.pop(p.employee)
			else:
				out.append({"employee": p.employee, "employee_name": p.employee_name, "time_in": None, "time_out": p.time})
	out.extend(open_.values())
	today = nowdate()
	for s in out:
		start, end = s["time_in"], s["time_out"]
		s["date"] = str((start or end))[:10]
		if start and end:
			s["minutes"] = max(int((get_datetime(end) - get_datetime(start)).total_seconds() // 60), 0)
			s["status"] = "Completed"
		elif start:
			s["minutes"] = minutes_since(start) if s["date"] == today else None
			s["status"] = "In clinic" if s["date"] == today else "No check-out"
		else:
			s["minutes"] = None
			s["status"] = "No check-in"
	out.sort(key=lambda s: str(s["time_in"] or s["time_out"]), reverse=True)
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
