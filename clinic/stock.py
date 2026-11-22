"""Clinic Store stock for prescribing: balances beside each drug, no prescribing what is out of stock,
and similar drugs offered in its place."""
import re

import frappe
from frappe import _
from frappe.utils import flt

# medicines that do much the same job; a drug that is out of stock is replaced from its own group
GROUPS = [
	("penicillin", ["amoxycillin", "amoxyclav", "ampiclox", "flucloxacillin", "benzyl penicillin", "benzathine"]),
	("macrolide", ["azithromycin", "erythromycin", "clarithromycin"]),
	("cephalosporin", ["cefixime", "ceftriaxone", "cefuroxime", "cephalexin"]),
	("quinolone", ["ciprofloxacin", "levofloxacin", "norfloxacin"]),
	("nitroimidazole", ["metronidazole", "secnidazole"]),
	("cotrimoxazole", ["ctx", "cotrimoxazole"]),
	("pain and fever", ["paracetamol", "diclofenac", "brufen", "ibuprofen", "meloxicam", "piroxicam", "mefenamic", "tramadol", "dinac"]),
	("antimalarial", ["artemether", "artesunate", "lumefantrine"]),
	("antihistamine", ["chlorpheniramine", "piriton", "cetrizine", "cetirizine"]),
	("acid", ["omeprazole", "esomeprazole", "gastrogel"]),
	("antiemetic", ["metoclopramide", "metorchlopramide", "domperidone"]),
	("antifungal", ["fluconazole", "griseofulvin", "clotrimazole", "nystatin", "clozole"]),
	("steroid", ["dexamethasone", "prednisolone", "prednisonol", "hydrocortisone"]),
	("diabetes", ["glucomet", "metformin", "glibenclamide", "nogluc"]),
	("blood pressure", ["nifedipine", "enalapril", "methyldopa", "carvedilol", "presartan"]),
	("anti-infective gel", ["silver sulfadiazine", "betadine"]),
	("fluids", ["iv dex", "normal saline", "ringers", "oral rehydrating", "ors"]),
]
LIQUID = ("ml", "suspension", "syrup", "drops", "solution", "cream", "gel", "ointment", "inj", "iv ", "spray")


def warehouse():
	wh = frappe.db.get_single_value("Clinic Settings", "store_warehouse")
	return wh if wh and frappe.db.exists("Warehouse", wh) else None


def balances(items=None):
	"""{item: quantity in the Clinic Store}, or None when no store is set up (stock is then not tracked)."""
	wh = warehouse()
	if not wh:
		return None
	filters = {"warehouse": wh}
	if items is not None:
		if not items:
			return {}
		filters["item_code"] = ["in", list(items)]
	return {b.item_code: flt(b.actual_qty) for b in frappe.get_all("Bin", filters=filters, fields=["item_code", "actual_qty"])}


def _stem(name):
	return re.split(r"[\s/(]", (name or "").strip().lower())[0]


def _groups(name):
	n = (name or "").lower()
	return {g for g, keys in GROUPS if any(k in n for k in keys)}


def _liquid(name):
	n = (name or "").lower()
	return any(w in n for w in LIQUID)


def alternatives(item_name, stock, limit=4):
	"""In-stock medicines like this one: same medicine in another strength first, then the same kind of medicine."""
	from clinic import billing
	from clinic.setup import ensure_drug_group

	stem, groups, liquid = _stem(item_name), _groups(item_name), _liquid(item_name)
	found = []
	for item in frappe.get_all("Item", filters={"disabled": 0, "item_group": ensure_drug_group()}, fields=["name", "item_name", "stock_uom"]):
		have = stock.get(item.name, 0)
		if have <= 0 or item.item_name == item_name:
			continue
		same = len(stem) >= 4 and _stem(item.item_name) == stem
		kin = bool(groups & _groups(item.item_name))
		if not (same or kin):
			continue
		found.append((0 if same else 1, 0 if _liquid(item.item_name) == liquid else 1, -have, item))
	found.sort(key=lambda x: x[:3])
	info = billing.drug_info()
	out = []
	for _a, _b, _c, item in found[:limit]:
		row = {"name": item.name, "item_name": item.item_name, "stock_uom": item.stock_uom, "stock": stock.get(item.name, 0)}
		row.update(info.get(item.name) or {"price": 0, "course_qty": 1, "strength": None, "dose_days": 0})
		out.append(row)
	return out


def stock_view(item_names):
	"""{item: {stock, alternatives}} for the drugs on screen. Items that are not tracked carry stock None."""
	stock = balances()
	if stock is None:
		return {n: {"stock": None, "alternatives": []} for n in item_names}
	names = {r.name: r.item_name for r in frappe.get_all("Item", filters={"name": ["in", list(item_names)]}, fields=["name", "item_name"])} if item_names else {}
	out = {}
	for n in item_names:
		have = stock.get(n, 0)
		out[n] = {"stock": have, "alternatives": alternatives(names.get(n, n), stock) if have <= 0 else []}
	return out


def check_prescriptions(doc):
	"""A drug that is out of stock cannot be newly prescribed. Rows that were already on the saved record,
	and records already sent to the pharmacy, are left alone."""
	if doc.get("dispensing") or not doc.get("prescriptions"):
		return
	stock = balances()
	if stock is None:
		return
	before = doc.get_doc_before_save()
	old = {r.drug for r in before.prescriptions} if before else set()
	for row in doc.prescriptions:
		if not row.drug or row.drug in old:
			continue
		if not frappe.db.get_value("Item", row.drug, "is_stock_item"):
			continue
		if stock.get(row.drug, 0) <= 0:
			alts = alternatives(frappe.db.get_value("Item", row.drug, "item_name"), stock, limit=3)
			hint = _(" In stock instead: {0}.").format(", ".join(f"{a['item_name']} ({a['stock']:g})" for a in alts)) if alts else ""
			frappe.throw(_("{0} is out of stock and cannot be prescribed.").format(row.drug) + hint)
