"""Data for the printable documents: investigation referrals (lab / imaging) and employment medical certificates."""

import frappe
from frappe import _
from frappe.utils import now_datetime

from clinic.api.common import clinic_profile, patient_card, require_any, user_name

SIGNING_DESIGNATIONS = ("Doctor", "Clinical Officer")
REFERRAL_TYPES = ("Laboratory", "Imaging")


def _signer(user):
	"""Who signs: the clinician who saw the patient, with their registration details."""
	profile = (
		frappe.db.get_value(
			"Clinic Staff Profile", {"user": user}, ["designation", "registration_no", "signature"], as_dict=True
		)
		if user
		else None
	)
	return {
		"name": user_name(user),
		"designation": profile.designation if profile else None,
		"registration_no": profile.registration_no if profile else None,
		"signature": profile.signature if profile else None,
		"can_sign": bool(profile and profile.designation in SIGNING_DESIGNATIONS),
	}


def _base(consultation):
	doc = frappe.get_doc("Clinic Consultation", consultation)
	triage = frappe.db.get_value("Clinic Triage", doc.triage, "*", as_dict=True) if doc.triage else None
	return doc, {
		"clinic": clinic_profile(),
		"patient": patient_card(doc.patient),
		"visit": doc.visit,
		"consultation": doc.name,
		"consultation_date": doc.consultation_date,
		"triage": triage,
		"signer": _signer(doc.doctor),
		"printed_by": user_name(frappe.session.user),
		"printed_on": now_datetime(),
	}


@frappe.whitelist()
def referral(consultation, category):
	"""Request form sent with the patient to an external laboratory or imaging centre."""
	require_any("consultation")
	if category not in REFERRAL_TYPES:
		frappe.throw(_("Unknown referral type {0}").format(category))
	doc, data = _base(consultation)
	rows = [r for r in doc.investigations if r.category == category]
	if not rows:
		frappe.throw(_("No {0} investigations have been requested on this consultation").format(category.lower()))
	data.update(
		category=category,
		items=[
			{"investigation": r.investigation, "urgency": r.urgency, "clinical_notes": r.clinical_notes}
			for r in rows
		],
		referred_to=next((r.referred_to for r in rows if r.referred_to), None),
		urgent=any(r.urgency == "Urgent" for r in rows),
		complaint=doc.presenting_complaint,
		history=doc.history_of_presenting_illness,
		diagnoses=[{"diagnosis": d.diagnosis, "type": d.diagnosis_type} for d in doc.diagnoses],
		drug_allergies=doc.drug_allergies,
	)
	doc.add_comment("Info", _("{0} referral printed by {1}").format(category, user_name(frappe.session.user)))
	return data


@frappe.whitelist()
def medical_certificate(consultation):
	"""Pre- or post-employment medical examination report."""
	require_any("consultation")
	doc, data = _base(consultation)
	if doc.consultation_type == "Consultation":
		frappe.throw(_("This is a normal consultation, not an employment medical"))
	data.update(
		exam_type=doc.consultation_type,
		job_position=doc.job_position,
		fitness_status=doc.fitness_status,
		valid_until=doc.certificate_valid_until,
		restrictions=doc.fitness_restrictions,
		remarks=doc.medical_remarks,
		tests=[{"test": t.test, "result": t.result, "findings": t.findings} for t in doc.medical_tests],
		history={
			"Past medical": doc.past_medical_history,
			"Past surgical": doc.past_surgical_history,
			"Current medication": doc.current_medication,
			"Allergies": doc.drug_allergies,
			"Family": doc.family_history,
			"Occupational": doc.occupational_history,
		},
		investigations=[
			{"investigation": r.investigation, "category": r.category} for r in doc.investigations
		],
		diagnoses=[{"diagnosis": d.diagnosis, "type": d.diagnosis_type} for d in doc.diagnoses],
	)
	doc.add_comment("Info", _("Medical certificate printed by {0}").format(user_name(frappe.session.user)))
	return data


@frappe.whitelist()
def weekly_report(week=None, include_sunday=0):
	"""The weekly clinic activity report: one column per day."""
	require_any("consultation")
	from clinic.reports import weekly_data

	return {
		"clinic": clinic_profile(),
		"report": weekly_data(week, int(include_sunday or 0)),
		"printed_by": user_name(frappe.session.user),
		"printed_on": now_datetime(),
	}


@frappe.whitelist()
def monthly_report(month=None):
	"""The clinical officer's monthly report for the month containing `month` (YYYY-MM or a date)."""
	require_any("consultation")
	from clinic.reports import monthly_data

	if month and len(month) == 7:
		month += "-01"
	data = monthly_data(month)
	data.update(clinic=clinic_profile(), printed_by=user_name(frappe.session.user), printed_on=now_datetime())
	return data


# ------------------------------------------------------------------ patient file
FILE_SCOPES = ("encounter", "full")

HISTORY_FIELDS = [
	("Past medical history", "past_medical_history"),
	("Past surgical history", "past_surgical_history"),
	("Current medication", "current_medication"),
	("Drug allergies", "drug_allergies"),
	("Family history", "family_history"),
	("Social history", "social_history"),
	("Occupational history", "occupational_history"),
]
SYSTEMS_FIELDS = [
	("CNS", "ros_cns"), ("GIT", "ros_git"), ("GUT", "ros_gut"), ("CVS", "ros_cvs"), ("Respiratory", "ros_rs"), ("Musculoskeletal", "ros_ms"),
]
EXAM_FIELDS = [
	("General", "exam_general"), ("CVS", "exam_cvs"), ("Respiratory", "exam_rs"), ("Abdomen", "exam_abdomen"),
	("CNS", "exam_cns"), ("Musculoskeletal", "exam_ms"), ("Other", "exam_other"),
]


def _encounter(doc):
	"""One consultation as it goes into the patient file."""
	triage = frappe.db.get_value("Clinic Triage", doc.triage, "*", as_dict=True) if doc.triage else None
	dispensed = {}
	if doc.dispensing and frappe.db.get_value("Clinic Dispensing", doc.dispensing, "docstatus") == 1:
		for row in frappe.get_all("Clinic Dispensing Item", filters={"parent": doc.dispensing}, fields=["drug", "dispensed_qty", "not_available"]):
			dispensed[row.drug] = row
	pick_fields = lambda pairs: [(label, doc.get(field)) for label, field in pairs if doc.get(field)]  # noqa: E731
	return {
		"name": doc.name,
		"visit": doc.visit,
		"date": doc.consultation_date,
		"type": doc.consultation_type,
		"doctor": user_name(doc.doctor),
		"status": doc.status,
		"triage": triage,
		"vitals_summary": doc.vitals_summary,
		"complaint": doc.presenting_complaint,
		"hpi": doc.history_of_presenting_illness,
		"systems": pick_fields(SYSTEMS_FIELDS),
		"history": pick_fields(HISTORY_FIELDS),
		"exam": pick_fields(EXAM_FIELDS),
		"medical": {
			"job_position": doc.job_position,
			"fitness_status": doc.fitness_status,
			"valid_until": doc.certificate_valid_until,
			"restrictions": doc.fitness_restrictions,
			"remarks": doc.medical_remarks,
			"tests": [{"test": t.test, "result": t.result, "findings": t.findings} for t in doc.medical_tests],
		} if doc.consultation_type != "Consultation" else None,
		"diagnoses": [{"diagnosis": d.diagnosis, "type": d.diagnosis_type, "notes": d.notes} for d in doc.diagnoses],
		"work_related": doc.work_related,
		"investigations": [
			{
				"investigation": r.investigation, "category": r.category, "urgency": r.urgency, "notes": r.clinical_notes,
				"referred_to": r.referred_to, "status": r.result_status, "result_date": r.result_date, "flag": r.result_flag,
				"findings": r.result_findings, "impression": r.result_impression,
			}
			for r in doc.investigations
		],
		"investigations_notes": doc.investigations_notes,
		"results_review_notes": doc.get("results_review_notes"),
		"plan": doc.management_plan,
		"procedures": doc.procedures_done,
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
			"Clinic Consultation",
			filters={"patient": doc.patient, "status": "Completed"},
			pluck="name",
			order_by="consultation_date desc",
			limit_page_length=500,
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
