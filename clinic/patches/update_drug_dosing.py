import frappe

from clinic import price_data

UOM_BY_WORD = (("inhaler", "Nos"), ("kit", "Nos"), ("inj", "Vial"), ("iv ", "Bottle"), (" ml", "Bottle"), ("tabs", "Tablet"))


def _uom(name, strength):
	label = f"{name} {strength}".lower()
	for word, uom in UOM_BY_WORD:
		if word in label:
			return uom
	return "Tablet"


def _ensure_uom(uom):
	if not frappe.db.exists("UOM", uom):
		frappe.get_doc({"doctype": "UOM", "uom_name": uom, "enabled": 1}).insert(ignore_permissions=True)


def execute():
	"""Dose days, units per dose and price per dose, from the clinic's updated price list.
	Existing drugs keep their Item (and stock); drugs the list adds are created."""
	from clinic.setup import ensure_drug_group

	group = ensure_drug_group()
	pricing = frappe.get_single("Clinic Pricing")
	rows = {r.drug: r for r in pricing.drug_prices}
	for drug, strength, days, units, price in price_data.DRUGS:
		name = price_data.item_name(drug, strength)
		row = rows.get(name)
		if row is None:
			if not frappe.db.exists("Item", name):
				uom = _uom(drug, strength)
				_ensure_uom(uom)
				frappe.get_doc({"doctype": "Item", "item_code": name, "item_name": name, "item_group": group, "stock_uom": uom, "is_stock_item": 1, "allow_zero_valuation_rate": 1}).insert(ignore_permissions=True)
			row = pricing.append("drug_prices", {"drug": name, "drug_name": name})
		row.strength = strength or row.strength
		row.dose_days = days
		row.course_qty = price_data.course_qty(strength, units)
		row.price = price
	pricing.flags.ignore_permissions = True
	pricing.save()
