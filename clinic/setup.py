import frappe

from clinic import price_data
from clinic.seed_data import DIAGNOSES, LAB_TEST_TYPES, VACCINE_SCHEDULE

ROLES = [
	"Clinic Receptionist",
	"Clinic Nurse",
	"Clinic Doctor",
	"Clinic Specialty Nurse",
	"Clinic Lab Technician",
	"Clinic Pharmacist",
	"Clinic Manager",
	"HTS Officer",
]


def ensure_roles():
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)


DRUG_GROUP = "Clinic Drugs"


def ensure_drug_group():
	"""The Item Group holding the clinic's medicines, so prescribing never offers the farm's other stock."""
	if not frappe.db.exists("Item Group", DRUG_GROUP):
		frappe.get_doc(
			{"doctype": "Item Group", "item_group_name": DRUG_GROUP, "parent_item_group": "All Item Groups", "is_group": 0}
		).insert(ignore_permissions=True)
	return DRUG_GROUP


def load_price_lists():
	"""Replace the drug, lab and procedure price lists and the clinic visit fees with the printed price lists."""
	group = ensure_drug_group()
	failed = []
	pricing = frappe.get_single("Clinic Pricing")

	pricing.set("drug_prices", [])
	for drug, strength, days, units, price in price_data.DRUGS:
		name = price_data.item_name(drug, strength)
		try:
			if not frappe.db.exists("Item", name):
				frappe.get_doc(
					{"doctype": "Item", "item_code": name, "item_name": name, "item_group": group, "stock_uom": "Nos", "is_stock_item": 1}
				).insert(ignore_permissions=True)
		except Exception as e:  # one bad item must not stop the rest, or the update
			failed.append(f"{name}: {e}")
			continue
		pricing.append("drug_prices", {"drug": name, "drug_name": name, "strength": strength, "dose_days": days, "course_qty": price_data.course_qty(strength, units), "price": price})

	for test in price_data.NEW_LAB_TESTS:
		if not frappe.db.exists("Clinic Lab Test Type", test["test_name"]):
			frappe.get_doc({"doctype": "Clinic Lab Test Type", **test}).insert(ignore_permissions=True)
	pricing.set("lab_prices", [])
	for test_type, price in price_data.LAB_PRICES.items():
		if frappe.db.exists("Clinic Lab Test Type", test_type):
			pricing.append("lab_prices", {"test_type": test_type, "price": price})
		else:
			failed.append(f"lab test type missing: {test_type}")

	pricing.set("procedure_prices", [])
	for procedure, price, note in price_data.PROCEDURES:
		pricing.append("procedure_prices", {"procedure": procedure, "price": price, "note": note})
	pricing.update(price_data.VISIT_FEES)
	pricing.consultation_price = pricing.consultation_price or 350
	pricing.save(ignore_permissions=True)
	if failed:
		frappe.log_error("\n".join(failed), "Clinic price list load")
	return failed


def seed_lab_test_types():
	for test in LAB_TEST_TYPES:
		if frappe.db.exists("Clinic Lab Test Type", test["test_name"]):
			continue
		doc = frappe.get_doc({"doctype": "Clinic Lab Test Type", **test})
		doc.insert(ignore_permissions=True)


def seed_diagnoses():
	for name, icd_code, category, occupational in DIAGNOSES:
		if frappe.db.exists("Clinic Diagnosis", name):
			continue
		frappe.get_doc(
			{
				"doctype": "Clinic Diagnosis",
				"diagnosis": name,
				"icd_code": icd_code,
				"category": category,
				"is_occupational": occupational,
			}
		).insert(ignore_permissions=True)


EMPLOYERS = [
	("Bilashaka Flower Farm", 1),
	("Groove Limited", 0),
	("Vitaplant Farm", 0),
	("Loldia Ndulele Farm", 0),
	("Loldia Leshau Farm", 0),
	("Color Crops Farm", 0),
]


def seed_employers():
	"""The farms whose staff get sick sheets and are billed at the clinic."""
	for name, own in EMPLOYERS:
		if not frappe.db.exists("Clinic Employer", name):
			frappe.get_doc(
				{
					"doctype": "Clinic Employer",
					"employer_name": name,
					"uses_employee_records": own,
					"requires_sick_sheet": 1,
					"billed_at_clinic": 1,
				}
			).insert(ignore_permissions=True)


def seed_vaccine_schedule():
	"""The childhood immunization schedule every CWC card is built from."""
	schedule = frappe.get_single("Clinic Vaccine Schedule")
	if schedule.items:
		return
	for milestone, vaccine, age_days, optional in VACCINE_SCHEDULE:
		schedule.append(
			"items",
			{"milestone": milestone, "vaccine": vaccine, "age_days": age_days,
			 "grace_days": 14, "optional": optional, "enabled": 1},
		)
	schedule.save(ignore_permissions=True)


def before_install():
	ensure_roles()


def after_install():
	ensure_roles()
	seed_lab_test_types()
	seed_diagnoses()
	seed_employers()
	seed_vaccine_schedule()
