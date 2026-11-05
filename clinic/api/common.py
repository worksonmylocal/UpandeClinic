"""Helpers and endpoints shared by all the clinic web pages."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, now_datetime, nowdate

from clinic.utils import age_text

# Which roles may open which page. Managers and system managers may open all of them.
PAGE_ROLES = {
	"triage": ["Clinic Receptionist", "Clinic Nurse"],
	"consultation": ["Clinic Doctor"],
	"pharmacy": ["Clinic Pharmacist"],
	"attendance": ["Clinic Receptionist", "Clinic Nurse", "Clinic Doctor"],
	"insights": ["Clinic Doctor"],
	"firstaid": ["Clinic First Aider"],
}

ADMIN_ROLES = ["Clinic Manager"]
# First aiders only use their own page: they must never pass the checks that guard patient data
ALL_CLINIC_ROLES = sorted({r for page, roles in PAGE_ROLES.items() if page != "firstaid" for r in roles} | set(ADMIN_ROLES))

PATIENT_FIELDS = [
	"name",
	"full_name",
	"patient_type",
	"sex",
	"date_of_birth",
	"national_id",
	"phone",
	"next_of_kin",
	"next_of_kin_relationship",
	"next_of_kin_phone",
	"department",
	"employee",
	"village",
	"allergies",
	"chronic_conditions",
	"blood_group",
	"staff_no",
	"section",
	"marital_status",
	"occupation",
]
ACTIVE_VISIT = ["not in", ["Completed", "Cancelled"]]


def require(page):
	"""Raise PermissionError unless the current user works at this stage of the journey."""
	frappe.only_for(PAGE_ROLES[page] + ADMIN_ROLES)


def require_any(*pages):
	"""Allow users of any of these stages (plus managers)."""
	roles = ADMIN_ROLES[:]
	for page in pages:
		roles += PAGE_ROLES[page]
	frappe.only_for(roles)


def require_any_clinic_role():
	frappe.only_for(ALL_CLINIC_ROLES)


def allowed_pages():
	roles = set(frappe.get_roles())
	if roles & set(ADMIN_ROLES):
		return list(PAGE_ROLES)
	return [page for page, page_roles in PAGE_ROLES.items() if roles & set(page_roles)]


def minutes_since(value):
	if not value:
		return 0
	return max(int((now_datetime() - get_datetime(value)).total_seconds() // 60), 0)


def today_start():
	return f"{nowdate()} 00:00:00"


def user_name(user):
	return frappe.db.get_value("User", user, "full_name") if user else ""


def clean(value):
	"""Turn empty strings from web forms into None."""
	if isinstance(value, str):
		value = value.strip()
	return None if value in ("", None) else value


def to_number(value, integer=False):
	value = clean(value)
	if value is None:
		return None
	return cint(value) if integer else flt(value)


def pick(data, fields):
	"""Only the whitelisted keys, with empty strings turned into None."""
	return {key: clean(data.get(key)) for key in fields if key in data}


def patient_card(patient):
	"""Everything a page needs to show a patient banner."""
	if isinstance(patient, str):
		patient = frappe.db.get_value("Clinic Patient", patient, PATIENT_FIELDS, as_dict=True)
	patient = frappe._dict(patient)
	patient.age = age_text(patient.date_of_birth)
	open_visit = frappe.db.get_value(
		"Clinic Visit",
		{"patient": patient.name, "status": ACTIVE_VISIT},
		["name", "status"],
		as_dict=True,
	)
	patient.open_visit = open_visit
	patient.last_visit = frappe.db.get_value(
		"Clinic Visit", {"patient": patient.name, "status": "Completed"}, "visit_date", order_by="visit_date desc"
	)
	return patient


@frappe.whitelist()
def whoami():
	return {
		"user": frappe.session.user,
		"full_name": user_name(frappe.session.user),
		"pages": allowed_pages(),
	}


@frappe.whitelist()
def masters():
	"""Lookup lists used by the forms on every page."""
	require_any_clinic_role()
	return {
		"facilities": frappe.get_all(
			"Clinic Facility", fields=["name", "facility_type"], order_by="name asc"
		),
		"diagnoses": frappe.get_all(
			"Clinic Diagnosis",
			fields=["name", "icd_code", "category", "is_occupational"],
			order_by="name asc",
		),
		"investigations": frappe.get_all(
			"Clinic Investigation Type",
			filters={"enabled": 1},
			fields=["name", "category"],
			order_by="category asc, name asc",
		),
		"departments": frappe.get_all("Department", filters={"is_group": 0}, pluck="name", order_by="name"),
		"genders": frappe.get_all("Gender", pluck="name", order_by="name"),
	}


@frappe.whitelist()
def search_patients(q="", patient_type=None, limit=15):
	require_any_clinic_role()
	q = (q or "").strip()
	filters = {"patient_type": patient_type} if patient_type else {}
	or_filters = None
	if q:
		like = f"%{q}%"
		or_filters = [
			["full_name", "like", like],
			["national_id", "like", like],
			["phone", "like", like],
			["name", "like", like],
			["employee", "like", like],
			["staff_no", "like", like],
		]
	patients = frappe.get_all(
		"Clinic Patient",
		filters=filters,
		or_filters=or_filters,
		fields=PATIENT_FIELDS,
		order_by="modified desc",
		limit=cint(limit),
	)
	return [patient_card(p) for p in patients]


@frappe.whitelist()
def search_employees(q=""):
	"""Active employees, flagged when they already have a patient record."""
	require_any_clinic_role()
	q = (q or "").strip()
	or_filters = None
	if q:
		like = f"%{q}%"
		or_filters = [["employee_name", "like", like], ["name", "like", like], ["cell_number", "like", like]]
	employees = frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		or_filters=or_filters,
		fields=["name", "employee_name", "gender", "date_of_birth", "cell_number", "department"],
		order_by="employee_name asc",
		limit=15,
	)
	for employee in employees:
		employee.patient = frappe.db.get_value("Clinic Patient", {"employee": employee.name}, "name")
		employee.age = age_text(employee.date_of_birth)
	return employees


@frappe.whitelist()
def register_patient(data):
	"""Create a patient record. Employees are picked from the Employee list."""
	require_any_clinic_role()
	data = frappe.parse_json(data)
	fields = [
		"patient_type", "employee", "staff_no", "section", "full_name", "sex", "date_of_birth", "national_id", "phone",
		"village", "marital_status", "occupation", "next_of_kin", "next_of_kin_relationship", "next_of_kin_phone",
		"blood_group", "allergies", "chronic_conditions",
	]
	doc = frappe.get_doc({"doctype": "Clinic Patient", **pick(data, fields)})
	doc.insert()
	return patient_card(doc.name)


@frappe.whitelist()
def check_in(patient, visit_purpose="Consultation", visit_source="Walk-in", referring_facility=None,
			 referring_clinician=None, referral_reason=None, reception_notes=None):
	"""Open a visit for a patient who has just arrived."""
	require_any_clinic_role()
	visit = frappe.get_doc(
		{
			"doctype": "Clinic Visit",
			"patient": patient,
			"visit_purpose": visit_purpose,
			"visit_source": visit_source,
			"referring_facility": clean(referring_facility),
			"referring_clinician": clean(referring_clinician),
			"referral_reason": clean(referral_reason),
			"reception_notes": clean(reception_notes),
		}
	).insert()
	return {"visit": visit.name, "status": visit.status}


@frappe.whitelist()
def cancel_visit(visit):
	require_any_clinic_role()
	frappe.get_doc("Clinic Visit", visit).cancel_visit()
	return {"visit": visit, "status": "Cancelled"}


@frappe.whitelist()
def add_facility(facility_name, facility_type="Clinic"):
	require_any_clinic_role()
	if not frappe.db.exists("Clinic Facility", facility_name):
		frappe.get_doc(
			{"doctype": "Clinic Facility", "facility_name": facility_name, "facility_type": facility_type}
		).insert(ignore_permissions=True)
	return facility_name


@frappe.whitelist()
def clinic_profile():
	"""Letterhead details for printed documents (edited in Clinic Settings)."""
	require_any_clinic_role()
	settings = frappe.get_cached_doc("Clinic Settings")
	return {
		field: settings.get(field)
		for field in (
			"clinic_name", "company_name", "licence_no", "website", "po_box", "head_office", "farm_location",
			"phone", "email", "report_footer_note",
		)
	}


def period_range(period):
	"""(first day, last day) for the Day / Week / Month filter on the Insights tabs: today, this week (from Monday), this month."""
	today = getdate(nowdate())
	if period == "week":
		return add_days(today, -today.weekday()), today
	if period == "month":
		return today.replace(day=1), today
	return today, today
