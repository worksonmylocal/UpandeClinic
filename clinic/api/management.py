"""The Management tab: the weekly duty rota (more management tools can sit alongside it)."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from clinic import rota, stock
from clinic.api.common import clinic_profile, require

DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _settings():
	s = frappe.get_cached_doc("Clinic Settings")
	staff = [
		{"name": r.staff_name, "on_call_order": r.on_call_order or 0}
		for r in sorted(s.rota_staff, key=lambda r: r.idx) if r.active
	]
	return s, staff


def _anchor(settings):
	if not settings.rota_anchor:
		frappe.throw(_("Set 'Rota Week 1 Starts On' in Clinic Settings first"))
	return getdate(settings.rota_anchor)


def _monday(week_start):
	return rota.monday_of(getdate(week_start or nowdate()))


def _history(anchor):
	"""Which weeks each person worked the weekend, for the fairness of the next rota."""
	out = []
	for name in frappe.get_all("Clinic Duty Rota", pluck="name", order_by="week_start asc"):
		doc = frappe.get_doc("Clinic Duty Rota", name)
		out.append((rota.weeks_since(anchor, doc.week_start), [r.staff_name for r in doc.rows if r.sat == "M"]))
	return out


def _shape(doc):
	if not doc:
		return None
	return {
		"name": doc.name, "status": doc.status, "on_call": doc.on_call, "notes": doc.notes, "week_label": doc.week_label,
		"rows": [{"staff_name": r.staff_name, "days": [r.get(d) or "" for d in rota.DAYS]} for r in doc.rows],
	}


@frappe.whitelist()
def rota_state(week_start=None):
	require("management")
	settings, staff = _settings()
	anchor = _anchor(settings)
	monday = _monday(week_start)
	doc = frappe.get_doc("Clinic Duty Rota", str(monday)) if frappe.db.exists("Clinic Duty Rota", str(monday)) else None
	shaped = _shape(doc)
	recent = frappe.get_all("Clinic Duty Rota", fields=["week_start", "week_label", "on_call", "status"], order_by="week_start desc", limit=12)
	return {
		"week_start": str(monday), "week_end": str(add_days(monday, 6)), "label": rota.week_label(anchor, monday),
		"days": [{"label": DAY_LABELS[i], "date": str(add_days(monday, i))} for i in range(7)],
		"rota": shaped, "staff": staff, "recent": recent,
		"problems": rota.check({r["staff_name"]: r["days"] for r in shaped["rows"]}) if shaped else [],
		"proposed_on_call": rota.build(staff, rota.weeks_since(anchor, monday))["on_call"] if staff else None,
	}


def _generate_one(staff, anchor, monday, replace):
	existing = frappe.db.exists("Clinic Duty Rota", str(monday))
	if existing and not replace:
		return False
	n = rota.weeks_since(anchor, monday)
	built = rota.build(staff, n, [h for h in _history(anchor) if h[0] != n])
	doc = frappe.get_doc("Clinic Duty Rota", existing) if existing else frappe.new_doc("Clinic Duty Rota")
	doc.week_start = monday
	doc.week_label = rota.week_label(anchor, monday)
	doc.on_call = built["on_call"]
	doc.status = "Draft"
	doc.rows = []
	for s in staff:
		doc.append("rows", {"staff_name": s["name"], **dict(zip(rota.DAYS, built["rows"][s["name"]]))})
	doc.flags.ignore_permissions = True
	doc.save() if existing else doc.insert()
	return True


@frappe.whitelist()
def generate_rota(week_start, replace=0, weeks=1):
	"""Work out the rota for one week or several in a row (each week builds on the weekends already given out).
	An existing week is only replaced when asked, and only for a single week."""
	require("management")
	settings, staff = _settings()
	if not staff:
		frappe.throw(_("Add the staff on the rota in Clinic Settings first"))
	anchor = _anchor(settings)
	monday = _monday(week_start)
	weeks = max(1, min(int(weeks or 1), 26))
	if weeks == 1:
		if not _generate_one(staff, anchor, monday, int(replace)):
			frappe.throw(_("A rota already exists for the week of {0}").format(monday))
		return rota_state(str(monday))
	created = skipped = 0
	for i in range(weeks):
		if _generate_one(staff, anchor, add_days(monday, 7 * i), False):
			created += 1
		else:
			skipped += 1
	state = rota_state(str(monday))
	state["range_result"] = {"created": created, "skipped": skipped, "weeks": weeks}
	return state


@frappe.whitelist()
def save_rota(week_start, rows, on_call=None, status="Draft", notes=None):
	"""Keep the manager's hand edits (a swap, leave) and publish when happy."""
	require("management")
	monday = _monday(week_start)
	doc = frappe.get_doc("Clinic Duty Rota", str(monday))
	rows = frappe.parse_json(rows)
	by = {r["staff_name"]: r["days"] for r in rows}
	for r in doc.rows:
		if r.staff_name in by:
			for d, code in zip(rota.DAYS, by[r.staff_name]):
				r.set(d, code if code in ("M", "A", "O", "x") else "")
	doc.on_call = on_call or doc.on_call
	doc.status = "Published" if status == "Published" else "Draft"
	doc.notes = notes
	doc.flags.ignore_permissions = True
	doc.save()
	return rota_state(str(monday))


@frappe.whitelist()
def rota_document(week_start, weeks=1):
	"""One or more weeks for printing: every week in the range that has a rota."""
	require("management")
	monday = _monday(week_start)
	out = []
	for i in range(max(1, min(int(weeks or 1), 26))):
		state = rota_state(str(add_days(monday, 7 * i)))
		if state["rota"]:
			out.append(state)
	if not out:
		frappe.throw(_("There is no rota for this period yet"))
	return {"clinic": clinic_profile(), "weeks": out}


# ----------------------------------------------------------------------------- Receive stock
def _store():
	wh = stock.warehouse()
	if not wh:
		frappe.throw(_("The Clinic Store is not set up. Choose it under 'Store Warehouse' in Clinic Settings."))
	return wh


@frappe.whitelist()
def stock_state():
	"""Clinic Store balances for every clinic medicine, and the latest deliveries."""
	require("management")
	from clinic.setup import ensure_drug_group

	wh = stock.warehouse()
	if not wh:
		return {"warehouse": None, "items": [], "recent": []}
	have = stock.balances() or {}
	items = frappe.get_all("Item", filters={"disabled": 0, "item_group": ensure_drug_group()}, fields=["name", "item_name", "stock_uom"], order_by="item_name asc")
	for i in items:
		i["stock"] = have.get(i.name, 0)
	recent = []
	for se in frappe.get_all("Stock Entry", filters={"docstatus": 1, "stock_entry_type": "Material Receipt", "to_warehouse": wh},
			fields=["name", "posting_date", "owner", "remarks"], order_by="creation desc", limit=15):
		rows = frappe.get_all("Stock Entry Detail", filters={"parent": se.name}, fields=["item_code", "qty"], order_by="idx asc")
		recent.append({"name": se.name, "date": str(se.posting_date), "by": frappe.db.get_value("User", se.owner, "full_name") or se.owner,
			"remarks": se.remarks or "", "lines": [{"item": r.item_code, "qty": r.qty} for r in rows]})
	return {"warehouse": wh, "items": items, "recent": recent}


@frappe.whitelist()
def add_medicine(drug_name):
	"""A medicine the store has not stocked before: create it so it can be received and prescribed."""
	require("management")
	from clinic.setup import ensure_drug_group

	name = (drug_name or "").strip()
	if not name:
		frappe.throw(_("Type the medicine name"))
	existing = frappe.db.get_value("Item", {"item_name": name}, "name")
	if existing:
		return {"name": existing, "item_name": name, "stock_uom": frappe.db.get_value("Item", existing, "stock_uom"), "stock": 0}
	item = frappe.get_doc({"doctype": "Item", "item_code": name, "item_name": name, "item_group": ensure_drug_group(), "stock_uom": "Nos",
		"is_stock_item": 1, "description": "Added from Receive Stock"})
	item.insert(ignore_permissions=True)
	return {"name": item.name, "item_name": item.item_name, "stock_uom": item.stock_uom, "stock": 0}


@frappe.whitelist()
def receive_stock(items, reference=None):
	"""Book a delivery into the Clinic Store as a submitted Material Receipt."""
	require("management")
	from clinic.setup import ensure_drug_group

	wh = _store()
	lines, seen = [], set()
	for row in frappe.parse_json(items) or []:
		item, qty = row.get("item"), flt(row.get("qty"))
		if not item or qty <= 0:
			continue
		if item in seen:
			frappe.throw(_("{0} is listed twice. Add the quantities together.").format(item))
		seen.add(item)
		info = frappe.db.get_value("Item", item, ["item_group", "stock_uom", "is_stock_item", "disabled"], as_dict=True)
		if not info or info.disabled or info.item_group != ensure_drug_group():
			frappe.throw(_("{0} is not a clinic medicine").format(item))
		if not info.is_stock_item:
			frappe.db.set_value("Item", item, "is_stock_item", 1)  # receiving stock means the clinic now counts it
		lines.append({"item_code": item, "qty": qty, "uom": info.stock_uom, "stock_uom": info.stock_uom, "conversion_factor": 1,
			"t_warehouse": wh, "allow_zero_valuation_rate": 1})
	if not lines:
		frappe.throw(_("Add at least one medicine with a quantity"))
	who = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	remarks = _("Received at the clinic by {0}").format(who) + (f". {reference.strip()}" if (reference or "").strip() else "")
	se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Receipt", "purpose": "Material Receipt",
		"company": frappe.db.get_value("Warehouse", wh, "company"), "to_warehouse": wh, "remarks": remarks, "items": lines})
	se.insert(ignore_permissions=True)
	se.submit()
	return {"name": se.name, "lines": len(lines), "state": stock_state()}
