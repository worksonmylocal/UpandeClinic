import frappe

from clinic.setup import (
	ensure_roles,
	load_price_lists,
	seed_diagnoses,
	seed_employers,
	seed_lab_test_types,
	seed_vaccine_schedule,
)


def execute():
	"""Put back the lists every desk depends on if a site has lost them (farms, diagnoses, lab tests, price lists, vaccine schedule).
	Nothing that already exists is touched, except the price lists, which are only loaded when the pricing table is empty."""
	ensure_roles()
	seed_employers()
	seed_lab_test_types()
	seed_diagnoses()
	seed_vaccine_schedule()
	if not frappe.get_single("Clinic Pricing").drug_prices:
		load_price_lists()
