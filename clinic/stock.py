"""Pharmacy stock: what is on the shelf, what is already promised to waiting prescriptions, and the issue entry."""

import frappe
from frappe import _
from frappe.utils import flt, nowdate, nowtime

WAREHOUSE_NAME = "Clinic Pharmacy"


def pharmacy_warehouse():
	return frappe.db.get_single_value("Clinic Settings", "pharmacy_warehouse")


def main_store(company=None):
	"""The farm's Main Store warehouse, if it has one: the clinic drugs are kept there, in the Clinic Drugs group."""
	company = company or _company()
	abbr = frappe.db.get_value("Company", company, "abbr") if company else None
	name = f"Main Store - {abbr}" if abbr else None
	return name if name and frappe.db.exists("Warehouse", name) else None


def ensure_warehouse():
	"""Point Clinic Settings at the warehouse that holds the clinic drugs, once.

	Order: what is already set; the Main Store (drugs stay in the main store under the Clinic Drugs item group);
	otherwise a warehouse of the clinic's own.
	"""
	current = pharmacy_warehouse()
	if current and frappe.db.exists("Warehouse", current):
		return current
	company = _company()
	if not company:
		return None
	name = main_store(company)
	if not name:
		abbr = frappe.db.get_value("Company", company, "abbr")
		name = f"{WAREHOUSE_NAME} - {abbr}"
		if not frappe.db.exists("Warehouse", name):
			parent = f"All Warehouses - {abbr}"
			frappe.get_doc(
				{
					"doctype": "Warehouse",
					"warehouse_name": WAREHOUSE_NAME,
					"company": company,
					"parent_warehouse": parent if frappe.db.exists("Warehouse", parent) else None,
				}
			).insert(ignore_permissions=True)
	frappe.db.set_single_value("Clinic Settings", "pharmacy_warehouse", name)
	return name


def unbilled_items():
	"""Items that are shared between patients and so are never charged to one: the list in Clinic Settings."""
	return set(frappe.get_all("Clinic Unbilled Item", filters={"parent": "Clinic Settings"}, pluck="item"))


def on_hand(items):
	"""{item: quantity on the pharmacy shelf}."""
	warehouse = pharmacy_warehouse()
	if not warehouse or not items:
		return {}
	rows = frappe.get_all(
		"Bin", filters={"warehouse": warehouse, "item_code": ["in", list(items)]}, fields=["item_code", "actual_qty"]
	)
	return {r.item_code: flt(r.actual_qty) for r in rows}


def reserved(items, exclude_consultation=None):
	"""{item: quantity prescribed to patients still waiting at the pharmacy (not dispensed yet)}."""
	items = [i for i in (items or []) if i not in unbilled_items()]
	if not items:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT i.drug, SUM(i.prescribed_qty) AS qty
		FROM `tabClinic Dispensing Item` i JOIN `tabClinic Dispensing` d ON d.name = i.parent
		WHERE d.docstatus = 0 AND i.drug IN %(items)s AND IFNULL(d.consultation, '') != %(exclude)s
		GROUP BY i.drug
		""",
		{"items": list(items), "exclude": exclude_consultation or ""},
		as_dict=True,
	)
	return {r.drug: flt(r.qty) for r in rows}


def available(items, exclude_consultation=None):
	"""{item: quantity still free to prescribe} = on the shelf minus what waiting prescriptions already hold."""
	stock, held = on_hand(items), reserved(items, exclude_consultation)
	return {item: max(stock.get(item, 0) - held.get(item, 0), 0) for item in items}


def issue_dispensed(dispensing):
	"""Take what the pharmacist handed out off the shelf (Stock Entry: Material Issue)."""
	skip = unbilled_items()
	lines = [r for r in dispensing.items if flt(r.dispensed_qty) > 0 and not r.not_available and r.drug not in skip]
	if not lines:
		return
	warehouse = pharmacy_warehouse()
	if not warehouse:
		frappe.throw(_("Set the Pharmacy Warehouse in Clinic Settings first"))
	company = frappe.db.get_value("Warehouse", warehouse, "company")
	defaults = {k: v for k, v in accounting_defaults(company).items() if v}
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Issue",
			"purpose": "Material Issue",
			"company": company,
			"posting_date": nowdate(),
			"posting_time": nowtime(),
			"remarks": _("Dispensed at the clinic: {0} ({1})").format(dispensing.name, dispensing.patient_name),
			"items": [
				{
					"item_code": r.drug,
					"s_warehouse": warehouse,
					"qty": flt(r.dispensed_qty),
					"uom": frappe.db.get_value("Item", r.drug, "stock_uom"),
					**defaults,
				}
				for r in lines
			],
		}
	)
	entry.insert(ignore_permissions=True)
	entry.submit()
	dispensing.db_set("stock_entry", entry.name)


def reverse_issue(dispensing):
	if dispensing.stock_entry and frappe.db.get_value("Stock Entry", dispensing.stock_entry, "docstatus") == 1:
		frappe.get_doc("Stock Entry", dispensing.stock_entry).cancel()


@frappe.whitelist()
def add_opening_stock(quantity=100, rate=10):
	"""Book the starting stock of every clinic drug into the pharmacy warehouse (Material Receipt).

	Run from the bench: bench --site <site> execute clinic.stock.add_opening_stock --kwargs "{'quantity': 100, 'rate': 10}"
	The rate is the buying cost per unit, so the books get a real valuation.
	"""
	frappe.only_for(["System Manager", "Clinic Manager"])
	from clinic.api.consultation import drug_groups

	warehouse = ensure_warehouse()
	items = frappe.get_all("Item", filters={"disabled": 0, "is_stock_item": 1, "item_group": ["in", drug_groups()]}, pluck="name")
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Receipt",
			"purpose": "Material Receipt",
			"company": frappe.db.get_value("Warehouse", warehouse, "company"),
			"remarks": "Clinic pharmacy opening stock",
			"items": [
				{
					"item_code": i,
					"t_warehouse": warehouse,
					"qty": flt(quantity),
					"basic_rate": flt(rate),
					"uom": frappe.db.get_value("Item", i, "stock_uom"),
					**{k: v for k, v in accounting_defaults(frappe.db.get_value("Warehouse", warehouse, "company")).items() if v},
				}
				for i in items
			],
		}
	)
	entry.insert(ignore_permissions=True)
	entry.submit()
	return entry.name


# ---------------------------------------------------------------- first aid kits
KITS_GROUP = "First Aid Kits"


def _company():
	return frappe.defaults.get_global_default("company") or frappe.db.get_value("Company", {}, "name")


def ensure_kit_warehouse(kit_name):
	"""A warehouse per kit, under a 'First Aid Kits' group warehouse, so each kit's supplies are real stock.

	Farms whose Warehouse form has extra mandatory fields (e.g. a Farm) cannot have it created automatically:
	create the warehouse by hand and pick it on the kit."""
	try:
		return _create_kit_warehouse(kit_name)
	except frappe.MandatoryError as e:
		frappe.throw(
			_("The kit's warehouse could not be created automatically ({0}). Create a warehouse for this kit and select it in the Kit Warehouse field.").format(
				frappe.utils.strip_html(str(e))
			)
		)


def _create_kit_warehouse(kit_name):
	company = _company()
	abbr = frappe.db.get_value("Company", company, "abbr")
	root = f"All Warehouses - {abbr}"
	group = f"{KITS_GROUP} - {abbr}"
	if not frappe.db.exists("Warehouse", group):
		frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": KITS_GROUP,
				"company": company,
				"is_group": 1,
				"parent_warehouse": root if frappe.db.exists("Warehouse", root) else None,
			}
		).insert(ignore_permissions=True)
	name = f"{kit_name} Kit - {abbr}"
	if not frappe.db.exists("Warehouse", name):
		frappe.get_doc(
			{"doctype": "Warehouse", "warehouse_name": f"{kit_name} Kit", "company": company, "parent_warehouse": group}
		).insert(ignore_permissions=True)
	return name


def supply_groups():
	"""Item groups whose items can be put in a first aid kit: the clinic drugs and the first aid supplies."""
	from clinic.api.consultation import drug_groups

	group = frappe.db.get_single_value("Clinic Settings", "first_aid_item_group") or "First Aid Supplies"
	return list(set(drug_groups()) | {group})


def accounting_defaults(company):
	"""Cost centre and expense account for stock entries. Some farms have no default cost centre on the company,
	so the clinic's own cost centre (Clinic Settings, or one called 'Clinic - <abbr>') is used."""
	abbr, default_cc, adjustment = frappe.db.get_value("Company", company, ["abbr", "cost_center", "stock_adjustment_account"])
	cost_center = frappe.db.get_single_value("Clinic Settings", "cost_center")
	if not cost_center and frappe.db.exists("Cost Center", f"Clinic - {abbr}"):
		cost_center = f"Clinic - {abbr}"
	return {"cost_center": cost_center or default_cc, "expense_account": adjustment}


def _entry(doc, entry_type, source, target, rows, remarks):
	company = frappe.db.get_value("Warehouse", source or target, "company")
	defaults = {k: v for k, v in accounting_defaults(company).items() if v}
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": entry_type,
			"purpose": entry_type,
			"company": company,
			"posting_date": nowdate(),
			"posting_time": nowtime(),
			"remarks": remarks,
			"items": [
				{
					"item_code": r.item,
					"s_warehouse": source,
					"t_warehouse": target,
					"qty": flt(r.qty),
					"uom": frappe.db.get_value("Item", r.item, "stock_uom"),
					**defaults,
				}
				for r in rows
			],
		}
	)
	entry.insert(ignore_permissions=True)
	entry.submit()
	return entry.name


def transfer_to_kit(issue):
	"""Clinic Kit Issue: move supplies from the pharmacy to the kit (Material Transfer)."""
	source = pharmacy_warehouse()
	if not source:
		frappe.throw(_("Set the Pharmacy Warehouse in Clinic Settings first"))
	target = frappe.db.get_value("Clinic First Aid Kit", issue.kit, "warehouse")
	name = _entry(issue, "Material Transfer", source, target, issue.items, _("Issued to first aid kit {0} ({1})").format(issue.kit, issue.name))
	issue.db_set("stock_entry", name)


def issue_from_kit(case):
	"""Clinic First Aid Case: take the supplies used off the kit. A shortage never blocks recording the case."""
	if not case.items:
		return
	warehouse = frappe.db.get_value("Clinic First Aid Kit", case.kit, "warehouse") if case.kit else None
	if not warehouse:
		case.db_set("supplies_note", _("The first aider's kit has no warehouse, so supplies were not deducted."))
		return
	frappe.db.savepoint("first_aid_issue")
	try:
		name = _entry(case, "Material Issue", warehouse, None, case.items, _("First aid case {0}").format(case.name))
		case.db_set("stock_entry", name)
	except Exception as e:
		frappe.db.rollback(save_point="first_aid_issue")
		case.db_set("supplies_note", _("Supplies were not deducted from the kit: {0}").format(frappe.utils.strip_html(str(e))[:300]))


def reverse_entry(doc):
	if doc.stock_entry and frappe.db.get_value("Stock Entry", doc.stock_entry, "docstatus") == 1:
		frappe.get_doc("Stock Entry", doc.stock_entry).cancel()


def kit_stock(warehouse):
	"""[{item, item_name, uom, qty}] on a kit's shelf."""
	rows = frappe.get_all("Bin", filters={"warehouse": warehouse, "actual_qty": [">", 0]}, fields=["item_code", "actual_qty"])
	names = {i.name: i for i in frappe.get_all("Item", filters={"name": ["in", [r.item_code for r in rows] or [""]]}, fields=["name", "item_name", "stock_uom"])}
	return sorted(
		[{"item": r.item_code, "item_name": names[r.item_code].item_name, "uom": names[r.item_code].stock_uom, "qty": flt(r.actual_qty)} for r in rows if r.item_code in names],
		key=lambda r: r["item_name"],
	)
