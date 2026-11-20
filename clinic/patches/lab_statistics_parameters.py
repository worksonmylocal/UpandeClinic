"""Urinalysis in the lab's reading order, and Brucella Abortus / Melitensis each with a titre on the BAT."""

import frappe

from clinic.seed_data import LAB_TEST_TYPES

ANC_FIRST = 5  # Hb, blood group, rhesus, VDRL, blood sugar come before the urinalysis rows


def wanted(name):
	return next(t for t in LAB_TEST_TYPES if t["test_name"] == name)["parameters"]


def rebuild(name, rows):
	doc = frappe.get_doc("Clinic Lab Test Type", name)
	doc.set("parameters", [])
	for r in rows:
		doc.append("parameters", r)
	doc.save(ignore_permissions=True)


def execute():
	urine = wanted("Urinalysis")
	if frappe.db.exists("Clinic Lab Test Type", "Urinalysis"):
		rebuild("Urinalysis", urine)
	if frappe.db.exists("Clinic Lab Test Type", "ANC Profile"):
		doc = frappe.get_doc("Clinic Lab Test Type", "ANC Profile")
		head = [p.as_dict() for p in doc.parameters][:ANC_FIRST]
		keys = ("parameter", "result_type", "unit", "normal_low", "normal_high", "options")
		rebuild("ANC Profile", [{k: h.get(k) for k in keys} for h in head] + urine)
	bat = "BAT (Brucella Agglutination Test)"
	if frappe.db.exists("Clinic Lab Test Type", bat):
		rebuild(bat, wanted(bat))
