"""Data for the printable documents: the sick sheet (patient journey) and the payment receipt."""

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_last_day, getdate, now_datetime

from clinic import billing
from clinic.referrals import referral_for_visit
from clinic.api.common import clinic_profile, patient_card, require_any, user_name

SIGNING_DESIGNATIONS = ("Doctor", "Clinical Officer")


def _signer(user):
	"""Who signs the sick sheet: the clinician who saw the patient, with their registration details."""
	profile = frappe.db.get_value(
		"Clinic Staff Profile", {"user": user}, ["designation", "registration_no", "signature"], as_dict=True
	) if user else None
	return {
		"name": user_name(user),
		"designation": profile.designation if profile else None,
		"registration_no": profile.registration_no if profile else None,
		"signature": profile.signature if profile else None,
		"can_sign": bool(profile and profile.designation in SIGNING_DESIGNATIONS),
	}


@frappe.whitelist()
def sick_sheet(visit):
	"""The whole journey for one visit: triage, consultation, labs, pharmacy and charges."""
	require_any("pharmacy", "consultation", "antenatal", "mch", "tb")
	v = frappe.get_doc("Clinic Visit", visit)
	terms = billing.terms(visit)
	if not terms["sick_sheet"]:
		frappe.throw(_("A sick sheet is not required for this patient's employer"))
	patient = patient_card(v.patient)

	triage = frappe.db.get_value("Clinic Triage", v.triage, "*", as_dict=True) if v.triage else None

	consultation = attendance = None
	diagnoses = []
	if v.consultation:
		consultation = frappe.get_doc("Clinic Consultation", v.consultation).as_dict(no_nulls=True)
		diagnoses = [
			{"diagnosis": d.diagnosis, "type": d.diagnosis_type}
			for d in frappe.get_all(
				"Clinic Consultation Diagnosis",
				filters={"parent": v.consultation},
				fields=["diagnosis", "diagnosis_type"],
				order_by="idx",
			)
		]
	if v.attendance:
		attendance = frappe.get_doc("Clinic Attendance", v.attendance).as_dict(no_nulls=True)

	seen_by = (consultation or attendance or {}).get("doctor") or (consultation or attendance or {}).get("clinician")
	seen_on = (consultation or {}).get("consultation_date") or (attendance or {}).get("attendance_date") or v.visit_date

	sick_days = int((consultation or {}).get("sick_leave_days") or 0)
	light_days = int((consultation or {}).get("light_duty_days") or 0)
	off_from = getdate(seen_on)

	labs = []
	for test in frappe.get_all(
		"Clinic Lab Test",
		filters={"visit": visit, "status": ["!=", "Cancelled"]},
		fields=["name", "test_type", "category", "status", "interpretation", "result_comments", "performed_where", "resulted_on"],
		order_by="requested_on asc",
	):
		test["withheld"] = bool(frappe.db.get_value("Clinic Lab Test Type", test.test_type, "requires_consent"))
		test["results"] = []
		if test.status == "Resulted" and not test["withheld"]:
			test["results"] = [
				r for r in frappe.get_all(
					"Clinic Lab Test Result Item",
					filters={"parent": test.name},
					fields=["parameter", "value", "unit", "reference", "flag"],
					order_by="idx",
				) if (r.value or "").strip()
			]
		if test["withheld"]:
			test.interpretation = None
			test.result_comments = None
		labs.append(test)

	medicines, unavailable, dispensed_on = [], [], None
	dispensing = frappe.db.get_value(
		"Clinic Dispensing", {"visit": visit, "docstatus": ["!=", 2]}, ["name", "docstatus", "dispensed_on"], as_dict=True
	)
	if dispensing:
		dispensed_on = dispensing.dispensed_on
		for row in frappe.get_all(
			"Clinic Dispensing Item",
			filters={"parent": dispensing.name},
			fields=["drug_name", "drug", "dose", "route", "frequency", "duration_days", "prescribed_qty", "dispensed_qty", "uom", "instructions", "not_available"],
			order_by="idx",
		):
			(unavailable if row.not_available else medicines).append(row)

	frappe.get_doc("Clinic Visit", visit).add_comment("Info", _("Sick sheet opened by {0}").format(user_name(frappe.session.user)))
	return {
		"clinic": clinic_profile(),
		"visit": {"name": v.name, "visit_date": v.visit_date, "employer": terms["employer"]},
		"patient": patient,
		"triage": triage,
		"consultation": consultation,
		"attendance": attendance,
		"diagnoses": diagnoses,
		"labs": labs,
		"medicines": medicines,
		"unavailable": unavailable,
		"dispensed_on": dispensed_on,
		"seen_on": seen_on,
		"sick_days": sick_days,
		"light_duty_days": light_days,
		"off_from": str(off_from) if sick_days else None,
		"off_to": str(add_days(off_from, sick_days - 1)) if sick_days else None,
		"back_on": str(add_days(off_from, sick_days)) if sick_days else None,
		"bill": billing.summary(visit),
		"signer": _signer(seen_by),
		"printed_by": user_name(frappe.session.user),
		"printed_on": now_datetime(),
	}


@frappe.whitelist()
def receipt(bill):
	"""Payment receipt for a paid bill."""
	require_any("pharmacy")
	doc = frappe.get_doc("Clinic Bill", bill)
	if doc.status != "Paid":
		frappe.throw(_("This bill has not been paid yet"))
	visit = frappe.db.get_value("Clinic Visit", doc.visit, ["patient", "visit_date"], as_dict=True)
	patient = patient_card(visit.patient)
	doc.add_comment("Info", _("Receipt printed by {0}").format(user_name(frappe.session.user)))
	return {
		"clinic": clinic_profile(),
		"receipt_no": doc.receipt_no,
		"bill": doc.name,
		"visit": doc.visit,
		"visit_date": visit.visit_date,
		"patient": patient,
		"employer": doc.employer,
		"paid_on": doc.paid_on,
		"payment_mode": doc.payment_mode,
		"payment_reference": doc.payment_reference,
		"lines": [
			{"item_type": r.item_type, "description": r.description, "qty": flt(r.qty), "rate": flt(r.rate), "amount": flt(r.amount)}
			for r in doc.items
		],
		"totals": {
			"consultation": flt(doc.consultation_total),
			"procedures": flt(doc.procedure_total),
			"lab": flt(doc.lab_total),
			"drugs": flt(doc.drug_total),
			"total": flt(doc.total),
			"paid": flt(doc.amount_paid),
			"change": flt(doc.change_amount),
		},
		"received_by": user_name(doc.received_by),
		"printed_on": now_datetime(),
	}


@frappe.whitelist()
def invoice(bill):
	"""Invoice for the employer of a farm employee."""
	require_any("pharmacy")
	doc = frappe.get_doc("Clinic Bill", bill)
	if not doc.invoice_no:
		frappe.throw(_("No invoice has been issued for this bill"))
	visit = frappe.db.get_value("Clinic Visit", doc.visit, ["patient", "visit_date"], as_dict=True)
	patient = patient_card(visit.patient)
	employer = frappe.db.get_value("Clinic Employer", doc.employer, ["employer_name", "address", "contact_person", "phone", "email"], as_dict=True) if doc.employer else None
	settings = frappe.get_cached_doc("Clinic Settings")
	doc.add_comment("Info", _("Invoice printed by {0}").format(user_name(frappe.session.user)))
	return {
		"clinic": clinic_profile(),
		"invoice_no": doc.invoice_no,
		"invoiced_on": doc.invoiced_on,
		"status": doc.status,
		"paid_on": doc.paid_on,
		"receipt_no": doc.receipt_no,
		"bill": doc.name,
		"visit": doc.visit,
		"visit_date": visit.visit_date,
		"patient": patient,
		"employer": employer,
		"lines": [
			{"item_type": r.item_type, "description": r.description, "qty": flt(r.qty), "rate": flt(r.rate), "amount": flt(r.amount)}
			for r in doc.items
		],
		"total": flt(doc.total),
		"terms": settings.invoice_terms,
		"payment_details": settings.payment_details,
		"issued_by": user_name(doc.owner),
		"printed_on": now_datetime(),
	}


@frappe.whitelist()
def patient_referral(visit):
	"""Everything for the letter that goes with a patient referred to another facility."""
	require_any("pharmacy", "consultation")
	ref = referral_for_visit(visit)
	if not ref:
		frappe.throw(_("This patient has not been referred to another facility"))
	v = frappe.get_doc("Clinic Visit", visit)
	triage = frappe.db.get_value(
		"Clinic Triage", v.triage,
		["bp_systolic", "bp_diastolic", "pulse_rate", "temperature", "spo2", "respiratory_rate", "weight_kg", "height_cm", "chief_complaint"],
		as_dict=True,
	) if v.triage else None
	data = {
		"clinic": clinic_profile(), "patient": patient_card(v.patient), "visit": {"name": v.name, "visit_date": v.visit_date},
		"referral": ref, "triage": triage, "printed_by": user_name(frappe.session.user), "printed_on": now_datetime(),
		"diagnoses": [], "prescriptions": [], "labs": [], "summary": {},
	}
	if ref["source"] == "Clinic Consultation":
		c = frappe.get_doc("Clinic Consultation", ref["name"])
		clinician = c.doctor
		data["diagnoses"] = [{"diagnosis": d.diagnosis, "type": d.diagnosis_type} for d in c.diagnoses]
		data["prescriptions"] = [{"drug": r.drug_name or r.drug, "dose": r.dose, "frequency": r.frequency, "days": r.duration_days} for r in c.prescriptions]
		data["summary"] = {
			"complaint": c.presenting_complaint, "history": c.history_of_presenting_illness, "impression": c.impression,
			"management": c.management_plan, "procedures": c.procedures_done, "allergies": c.drug_allergies, "examination": c.general_examination,
		}
		labs = frappe.get_all("Clinic Lab Test", filters={"visit": visit, "status": ["!=", "Cancelled"]}, fields=["name", "test_type", "status", "interpretation"])
		for t in labs:
			t["results"] = [
				f"{r.parameter}: {r.value} {r.unit or ''}".strip()
				for r in frappe.get_all("Clinic Lab Test Result Item", filters={"parent": t.name}, fields=["parameter", "value", "unit"], order_by="idx asc")
				if (r.value or "").strip()
			]
		data["labs"] = labs
	else:
		a = frappe.get_doc("Clinic Attendance", ref["name"])
		clinician = a.clinician
		extra = {}
		if a.service_type == "ANC Attendance":
			extra = {"gestation": a.gestation_weeks, "edd": a.edd, "gravida": a.gravida, "parity": a.parity, "complications": a.complications, "anc_referral": a.anc_referral}
		data["summary"] = {"service": a.service_type, "complaint": triage.chief_complaint if triage else None, "impression": a.assessment_notes,
			"management": a.management_plan, **extra}
		data["prescriptions"] = [{"drug": r.drug_name or r.drug, "dose": r.dose, "frequency": r.frequency, "days": r.duration_days} for r in a.prescriptions]
	data["clinician"] = _signer(clinician)
	v.add_comment("Info", _("Referral letter opened by {0}").format(user_name(frappe.session.user)))
	return data


@frappe.whitelist()
def monthly_invoice(month, employer=None):
	"""One compounded invoice per farm for a month: each encounter's total per employee, and a grand total.

	`month` is YYYY-MM. Leave `employer` empty for every farm that was invoiced in the month.
	"""
	require_any("pharmacy")
	try:
		first = getdate(f"{month}-01")
	except Exception:
		frappe.throw(_("Choose the month as YYYY-MM"))
	last = get_last_day(first)
	filters = {
		"billing_mode": "Invoice", "status": ["in", ["Invoiced", "Paid"]],
		"invoiced_on": ["between", [f"{first} 00:00:00", f"{last} 23:59:59"]],
	}
	if employer:
		filters["employer"] = employer
	bills = frappe.get_all(
		"Clinic Bill", filters=filters, order_by="invoiced_on asc",
		fields=["name", "employer", "patient", "patient_name", "visit", "total", "status", "invoiced_on"],
	)
	dates = {v.name: v.visit_date for v in frappe.get_all("Clinic Visit", filters={"name": ["in", [b.visit for b in bills] or [""]]}, fields=["name", "visit_date"])}
	for b in bills:
		b.visit_date = dates.get(b.visit)
	bills.sort(key=lambda b: (str(b.visit_date or ""), b.patient_name or ""))  # in the order the patients were seen
	by_farm = {}
	for b in bills:
		by_farm.setdefault(b.employer, []).append(b)
	if employer and employer not in by_farm:
		by_farm[employer] = []
	farms = []
	for name in sorted(by_farm, key=lambda x: (x or "").lower()):
		rows = by_farm[name]
		details = frappe.db.get_value(
			"Clinic Employer", name, ["employer_name", "address", "contact_person", "phone", "email"], as_dict=True
		) if name else None
		farms.append({
			"employer": name, "details": details,
			"rows": [{"date": r.visit_date, "patient_name": r.patient_name, "amount": flt(r.total), "status": r.status} for r in rows],
			"count": len(rows),
			"total": sum(flt(r.total) for r in rows),
			"paid_total": sum(flt(r.total) for r in rows if r.status == "Paid"),
		})
	settings = frappe.get_cached_doc("Clinic Settings")
	return {
		"clinic": clinic_profile(), "month": month, "period": first.strftime("%B %Y"), "farms": farms,
		"terms": settings.invoice_terms, "payment_details": settings.payment_details,
		"printed_by": user_name(frappe.session.user), "printed_on": now_datetime(),
	}


# ------------------------------------------------------------------ patient file
FILE_SCOPES = ("encounter", "full")


def _encounter(doc):
	"""One consultation as it goes into the patient file."""
	triage = frappe.db.get_value("Clinic Triage", doc.triage, "*", as_dict=True) if doc.triage else None
	dispensed = {}
	if doc.dispensing and frappe.db.get_value("Clinic Dispensing", doc.dispensing, "docstatus") == 1:
		for row in frappe.get_all("Clinic Dispensing Item", filters={"parent": doc.dispensing}, fields=["drug", "dispensed_qty", "not_available"]):
			dispensed[row.drug] = row
	labs = frappe.get_all(
		"Clinic Lab Test", filters={"visit": doc.visit, "status": ["!=", "Cancelled"]},
		fields=["name", "test_type", "status", "interpretation", "performed_where", "external_facility", "result_comments", "resulted_on"],
		order_by="requested_on asc",
	)
	for t in labs:
		t["results"] = frappe.get_all(
			"Clinic Lab Test Result Item", filters={"parent": t.name}, fields=["parameter", "value", "unit", "reference", "flag"], order_by="idx asc"
		)
	systems = [(label, doc.get(f)) for label, f in [("Review of systems", "review_of_systems")] if doc.get(f)]
	history = [(label, doc.get(f)) for label, f in [
		("Past medical history", "past_medical_history"), ("Current medication", "current_medication"),
		("Drug allergies", "drug_allergies"), ("Family history", "family_history"), ("Social history", "social_history"),
		("Occupational history", "occupational_history")] if doc.get(f)]
	exam = [(label, doc.get(f)) for label, f in [("General", "general_examination"), ("Systemic", "systemic_examination")] if doc.get(f)]
	return {
		"name": doc.name,
		"visit": doc.visit,
		"date": doc.consultation_date,
		"type": doc.patient_type,
		"doctor": user_name(doc.doctor),
		"status": doc.status,
		"triage": triage,
		"complaint": doc.presenting_complaint,
		"hpi": doc.history_of_presenting_illness,
		"systems": systems,
		"history": history,
		"exam": exam,
		"tb_screening": doc.tb_screening,
		"diagnoses": [{"diagnosis": d.diagnosis, "type": d.diagnosis_type, "notes": d.notes} for d in doc.diagnoses],
		"impression": doc.impression,
		"work_related": doc.work_related,
		"labs": labs,
		"investigations_notes": doc.investigations_notes,
		"plan": doc.management_plan,
		"procedures": doc.procedures_done,
		"procedure_rows": [{"procedure": r.procedure, "qty": r.qty} for r in doc.get("procedures") or []],
		"advice": doc.patient_advice,
		"prescriptions": [
			{
				"drug": r.drug_name or r.drug, "dose": r.dose, "route": r.route, "frequency": r.frequency, "days": r.duration_days,
				"quantity": r.quantity, "instructions": r.instructions,
				"dispensed": dispensed[r.drug].dispensed_qty if r.drug in dispensed else None,
				"not_available": bool(r.drug in dispensed and dispensed[r.drug].not_available),
			}
			for r in doc.prescriptions
		],
		"incidents": frappe.get_all(
			"Clinic Incident", filters={"visit": doc.visit},
			fields=["name", "report_type", "severity", "incident_date", "cause", "injury_type", "body_part", "description", "outcome", "lost_days"],
		),
		"sick_leave_days": doc.sick_leave_days,
		"light_duty_days": doc.light_duty_days,
		"referral": {"facility": doc.referral_facility, "urgency": doc.referral_urgency, "reason": doc.referral_reason, "notes": doc.referral_notes} if doc.refer_out else None,
		"follow_up": {"date": doc.follow_up_date, "reason": doc.follow_up_reason} if doc.follow_up_required else None,
	}


@frappe.whitelist()
def patient_file(consultation, scope="encounter"):
	"""A patient's file for download: just the encounter they were seen in, or every completed encounter on record."""
	require_any("consultation")
	if scope not in FILE_SCOPES:
		frappe.throw(_("Unknown file type {0}").format(scope))
	doc = frappe.get_doc("Clinic Consultation", consultation)
	doc.check_permission("read")
	if scope == "full":
		names = frappe.get_all(
			"Clinic Consultation", filters={"patient": doc.patient, "status": "Completed"}, pluck="name",
			order_by="consultation_date desc", limit_page_length=500,
		)
		if consultation not in names:
			names.insert(0, consultation)
		docs = [frappe.get_doc("Clinic Consultation", n) for n in names]
	else:
		docs = [doc]
	patient = patient_card(doc.patient)
	# the file is the patient's most sensitive record: leave a trace of who took a copy
	doc.add_comment("Info", _("{0} patient file downloaded by {1}").format(
		_("Full") if scope == "full" else _("Encounter"), user_name(frappe.session.user)))
	return {
		"clinic": clinic_profile(),
		"patient": patient,
		"scope": scope,
		"consultation": doc.name,
		"signer": _signer(doc.doctor),
		"encounters": [_encounter(d) for d in docs],
		"printed_by": user_name(frappe.session.user),
		"printed_on": now_datetime(),
	}
