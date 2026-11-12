"""Data and actions behind the Triage / front desk page."""

import frappe
from frappe import _
from frappe.utils import add_days, get_datetime, nowdate

from clinic.api.common import (
	SEND_TO,
	clean,
	minutes_since,
	patient_card,
	period_range,
	require,
	to_number,
	today_start,
)

VITAL_INT = ["bp_systolic", "bp_diastolic", "pulse_rate", "respiratory_rate", "spo2"]
VITAL_FLOAT = ["temperature", "weight_kg", "height_cm", "blood_glucose"]
VITAL_TEXT = ["chief_complaint", "triage_priority", "triage_notes"]


@frappe.whitelist()
def dashboard():
	require("triage")
	start = today_start()

	waiting = frappe.get_all(
		"Clinic Visit",
		filters={"status": "Waiting Triage"},
		fields=[
			"name as visit", "patient", "patient_name", "patient_type", "sex", "age_years", "department",
			"visit_date", "visit_source", "visit_purpose", "reception_notes", "referring_facility",
		],
		order_by="visit_date asc",
	)
	for row in waiting:
		row.wait_minutes = minutes_since(row.visit_date)

	recent = frappe.db.sql(
		"""
		SELECT t.name AS triage, t.visit, t.patient, t.patient_name, t.patient_type, t.triage_priority,
			t.chief_complaint, t.alerts, t.triage_datetime, v.status, v.sex, v.age_years, v.service_point,
			TIMESTAMPDIFF(MINUTE, v.visit_date, t.triage_datetime) AS wait_minutes
		FROM `tabClinic Triage` t JOIN `tabClinic Visit` v ON v.name = t.visit
		WHERE t.triage_datetime >= %s
		ORDER BY t.triage_datetime DESC LIMIT 30
		""",
		start,
		as_dict=True,
	)

	kpi = frappe.db.sql(
		"""
		SELECT
			COUNT(*) AS visits,
			IFNULL(SUM(patient_type = 'Employee'), 0) AS employees,
			IFNULL(SUM(patient_type = 'Community Member'), 0) AS community,
			IFNULL(SUM(visit_source = 'Referral In'), 0) AS referrals_in
		FROM `tabClinic Visit` WHERE visit_date >= %s AND status != 'Cancelled'
		""",
		start,
		as_dict=True,
	)[0]
	triaged = frappe.db.sql(
		"""
		SELECT COUNT(*) AS triaged,
			IFNULL(SUM(t.triage_priority IN ('Urgent', 'Emergency')), 0) AS urgent,
			IFNULL(SUM(t.alerts IS NOT NULL AND t.alerts != ''), 0) AS with_alerts,
			AVG(TIMESTAMPDIFF(MINUTE, v.visit_date, t.triage_datetime)) AS avg_wait
		FROM `tabClinic Triage` t JOIN `tabClinic Visit` v ON v.name = t.visit
		WHERE t.triage_datetime >= %s
		""",
		start,
		as_dict=True,
	)[0]

	return {
		"kpis": {
			"waiting": len(waiting),
			"longest_wait": max((r.wait_minutes for r in waiting), default=0),
			"triaged_today": triaged.triaged,
			"avg_wait": round(triaged.avg_wait or 0),
			"urgent_today": triaged.urgent,
			"with_alerts": triaged.with_alerts,
			"visits_today": kpi.visits,
			"employees_today": kpi.employees,
			"community_today": kpi.community,
			"referrals_in_today": kpi.referrals_in,
		},
		"waiting": waiting,
		"recent": recent,
	}


DOOR_TARGET = 15  # minutes from checking in at the front desk to having vitals taken


def _door_to_triage(waits):
	waits = sorted(waits)
	n = len(waits)
	levels = [
		("Up to %d min" % DOOR_TARGET, "good", lambda m: m <= DOOR_TARGET),
		("%d–%d min" % (DOOR_TARGET + 1, DOOR_TARGET * 2), "warn", lambda m: DOOR_TARGET < m <= DOOR_TARGET * 2),
		("Over %d min" % (DOOR_TARGET * 2), "bad", lambda m: m > DOOR_TARGET * 2),
	]
	return {
		"target": DOOR_TARGET,
		"measured": n,
		"average": round(sum(waits) / n) if n else 0,
		"median": waits[n // 2] if n else 0,
		"longest": waits[-1] if n else 0,
		"within_target": round(sum(1 for m in waits if m <= DOOR_TARGET) * 100 / n) if n else 0,
		"buckets": [{"label": label, "level": level, "value": sum(1 for m in waits if test(m))} for label, level, test in levels],
	}


@frappe.whitelist()
def insights(period="day"):
	"""Triage figures for today, this week or this month."""
	require("triage")
	first, last = period_range(period)
	p = {"a": f"{first} 00:00:00", "b": f"{last} 23:59:59"}
	triages = frappe.db.sql(
		"""SELECT t.triage_datetime, v.visit_date FROM `tabClinic Triage` t JOIN `tabClinic Visit` v ON v.name = t.visit
		WHERE t.triage_datetime BETWEEN %(a)s AND %(b)s""",
		p,
		as_dict=True,
	)
	waits = [max(int((get_datetime(t.triage_datetime) - get_datetime(t.visit_date)).total_seconds() // 60), 0) for t in triages]
	registered = frappe.db.sql(
		"""SELECT HOUR(visit_date) AS hour, COUNT(*) AS n FROM `tabClinic Visit`
		WHERE visit_date BETWEEN %(a)s AND %(b)s AND status != 'Cancelled' GROUP BY HOUR(visit_date)""",
		p,
		as_dict=True,
	)
	triaged = frappe.db.sql(
		"""SELECT HOUR(triage_datetime) AS hour, COUNT(*) AS n FROM `tabClinic Triage`
		WHERE triage_datetime BETWEEN %(a)s AND %(b)s GROUP BY HOUR(triage_datetime)""",
		p,
		as_dict=True,
	)
	priority = frappe.db.sql(
		"""SELECT triage_priority AS label, COUNT(*) AS value FROM `tabClinic Triage`
		WHERE triage_datetime BETWEEN %(a)s AND %(b)s GROUP BY triage_priority""",
		p,
		as_dict=True,
	)
	flags = frappe.db.sql(
		"""
		SELECT
			IFNULL(SUM(alerts LIKE 'Fever%%' OR alerts LIKE '%%Fever (%%'), 0) AS fever,
			IFNULL(SUM(alerts LIKE '%%High BP%%'), 0) AS high_bp,
			IFNULL(SUM(alerts LIKE '%%Low oxygen%%'), 0) AS low_spo2,
			IFNULL(SUM(alerts LIKE '%%Tachycardia%%'), 0) AS tachycardia,
			IFNULL(SUM(alerts LIKE '%%glucose%%'), 0) AS glucose,
			IFNULL(SUM(bmi >= 30), 0) AS obese,
			COUNT(*) AS total
		FROM `tabClinic Triage` WHERE triage_datetime BETWEEN %(a)s AND %(b)s
		""",
		p,
		as_dict=True,
	)[0]
	return {
		"period": period,
		"range": {"from": str(first), "to": str(last)},
		"door_to_triage": _door_to_triage(waits),
		"by_hour": {
			"registered": [next((r.n for r in registered if r.hour == h), 0) for h in range(24)],
			"triaged": [next((r.n for r in triaged if r.hour == h), 0) for h in range(24)],
		},
		"priority": priority,
		"flags": flags,
	}


@frappe.whitelist()
def get_triage_context(visit):
	"""Patient banner, previous measurements (for prefill/trend) and any existing triage for a visit."""
	require("triage")
	visit_doc = frappe.db.get_value(
		"Clinic Visit",
		visit,
		["name", "patient", "patient_name", "patient_type", "status", "visit_source", "visit_date",
		 "reception_notes", "triage", "referring_facility", "referral_reason", "service_point", "visit_purpose"],
		as_dict=True,
	)
	previous = frappe.get_all(
		"Clinic Triage",
		filters={"patient": visit_doc.patient, "visit": ["!=", visit]},
		fields=["triage_datetime", "weight_kg", "height_cm", "bp_systolic", "bp_diastolic", "pulse_rate", "temperature"],
		order_by="triage_datetime desc",
		limit=5,
	)
	existing = frappe.db.get_value("Clinic Triage", visit_doc.triage, "*", as_dict=True) if visit_doc.triage else None
	return {
		"visit": visit_doc,
		"patient": patient_card(visit_doc.patient),
		"previous": previous,
		"existing": existing,
	}


@frappe.whitelist()
def save_triage(visit, data, send_to="Consultation"):
	"""Record (or update) vitals and send the patient on: to the doctor or to a clinic queue."""
	require("triage")
	if send_to not in SEND_TO:
		frappe.throw(_("Unknown destination {0}").format(send_to))
	data = frappe.parse_json(data)
	values = {f: to_number(data.get(f), integer=True) for f in VITAL_INT if f in data}
	values.update({f: to_number(data.get(f)) for f in VITAL_FLOAT if f in data})
	values.update({f: clean(data.get(f)) for f in VITAL_TEXT if f in data})

	# The destination is set first so the triage record routes the visit into the right queue
	frappe.db.set_value("Clinic Visit", visit, "service_point", send_to)
	existing = frappe.db.get_value("Clinic Visit", visit, "triage")
	if existing:
		doc = frappe.get_doc("Clinic Triage", existing)
		doc.update(values)
		doc.save()
	else:
		doc = frappe.get_doc({"doctype": "Clinic Triage", "visit": visit, **values}).insert()
	return {
		"triage": doc.name,
		"alerts": doc.alerts,
		"bmi": doc.bmi,
		"status": frappe.db.get_value("Clinic Visit", visit, "status"),
		"send_to": send_to,
	}
