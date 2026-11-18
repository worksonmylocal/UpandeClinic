"""Stock reports for the clinic pharmacy: balance as of a moment, a month's stock movement, and cost analysis.

All figures come from the Stock Ledger of the pharmacy warehouse, so they agree with ERPNext. Cost is the value of what
actually left the shelf (stock value difference of each issue), not a list price.
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, flt, get_first_day, get_last_day, getdate, nowdate, now_datetime

from clinic import stock
from clinic.api.common import clinic_profile, require_any, user_name

RECEIPT_VOUCHERS = ("Purchase Receipt", "Purchase Invoice")
DISPENSED_LIKE = "Dispensed at the clinic%"


def _guard():
	require_any("insights", "pharmacy", "reports")


def _warehouse():
	warehouse = stock.pharmacy_warehouse()
	if not warehouse:
		frappe.throw(_("Set the Pharmacy Warehouse in Clinic Settings first"))
	return warehouse


def _stamp(d, end_of_day=True):
	"""A date (or datetime) as the moment the figures are read at: end of that day, or right now for today / blank."""
	if not d:
		return now_datetime()
	day = getdate(d)
	if day >= getdate(nowdate()):
		return now_datetime()
	return f"{day} 23:59:59.999999" if end_of_day else f"{day} 00:00:00"


def _info(**extra):
	return {"clinic": clinic_profile(), "printed_by": user_name(frappe.session.user), "printed_on": now_datetime(), **extra}


def _balances(warehouse, moment):
	"""{item_code: (qty, rate, value)} on the shelf at this moment: the last ledger entry of each item up to then."""
	rows = frappe.db.sql(
		"""SELECT item_code, qty_after_transaction AS qty, valuation_rate AS rate, stock_value AS value FROM (
			SELECT item_code, qty_after_transaction, valuation_rate, stock_value,
				ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY posting_datetime DESC, creation DESC) AS rn
			FROM `tabStock Ledger Entry`
			WHERE warehouse = %(w)s AND is_cancelled = 0 AND posting_datetime <= %(at)s) t WHERE rn = 1""",
		{"w": warehouse, "at": moment},
		as_dict=True,
	)
	return {r.item_code: (flt(r.qty), flt(r.rate), flt(r.value)) for r in rows}


def _items(codes):
	if not codes:
		return {}
	rows = frappe.get_all(
		"Item", filters={"name": ["in", list(codes)]}, fields=["name", "item_name", "item_group", "stock_uom", "disabled"]
	)
	return {r.name: r for r in rows}


# ------------------------------------------------------------------ stock balance
def stock_balance(as_of=None):
	"""What is on the pharmacy shelf as of a moment (now, unless a past date is given)."""
	warehouse = _warehouse()
	moment = _stamp(as_of)
	bal = _balances(warehouse, moment)
	items = _items(bal)
	rows = []
	for code, (qty, rate, value) in bal.items():
		item = items.get(code)
		if not item:
			continue
		rows.append(
			{
				"item": code,
				"item_name": item.item_name,
				"group": item.item_group,
				"uom": item.stock_uom,
				"qty": qty,
				"rate": round(rate, 2),
				"value": round(value, 2),
				"disabled": cint(item.disabled),
			}
		)
	rows = [r for r in rows if r["qty"] or not r["disabled"]]
	rows.sort(key=lambda r: (r["group"] or "", (r["item_name"] or "").lower()))
	in_stock = [r for r in rows if r["qty"] > 0]
	return {
		"warehouse": warehouse,
		"as_of": str(moment)[:19],
		"live": getdate(as_of) >= getdate(nowdate()) if as_of else True,
		"rows": rows,
		"kpis": {
			"items": len(rows),
			"in_stock": len(in_stock),
			"out_of_stock": len(rows) - len(in_stock),
			"low": sum(1 for r in in_stock if r["qty"] <= 10),
			"value": round(sum(r["value"] for r in rows), 2),
		},
	}


# ------------------------------------------------------------------ monthly movement
def _month_bounds(month):
	first = get_first_day(getdate(f"{month}-01") if month else getdate(nowdate()))
	return first, get_last_day(first)


def stock_movement(month=None):
	"""For one month: opening, received, dispensed, other issues, adjustments and closing, item by item, plus each receipt."""
	warehouse = _warehouse()
	first, last = _month_bounds(month)
	start = f"{first} 00:00:00"
	end = _stamp(last)
	opening = _balances(warehouse, _stamp(add_days(first, -1)))
	closing = _balances(warehouse, end)

	moves = frappe.db.sql(
		"""SELECT s.item_code, s.voucher_type, s.voucher_no, s.actual_qty AS qty, s.stock_value_difference AS value,
			s.posting_date AS date, s.incoming_rate AS rate, IFNULL(se.remarks, '') AS remarks
		FROM `tabStock Ledger Entry` s LEFT JOIN `tabStock Entry` se ON se.name = s.voucher_no AND s.voucher_type = 'Stock Entry'
		WHERE s.warehouse = %(w)s AND s.is_cancelled = 0 AND s.posting_datetime BETWEEN %(a)s AND %(b)s AND s.voucher_type != 'Stock Reconciliation'
		ORDER BY s.posting_datetime""",
		{"w": warehouse, "a": start, "b": end},
		as_dict=True,
	)
	per = defaultdict(lambda: {"received": 0.0, "received_value": 0.0, "dispensed": 0.0, "dispensed_value": 0.0, "other": 0.0, "other_value": 0.0})
	receipts = []
	for m in moves:
		p = per[m.item_code]
		if flt(m.qty) > 0:
			p["received"] += flt(m.qty)
			p["received_value"] += flt(m.value)
			receipts.append(m)
		elif flt(m.qty) < 0:
			if m.remarks.startswith("Dispensed at the clinic"):
				p["dispensed"] += -flt(m.qty)
				p["dispensed_value"] += -flt(m.value)
			else:
				p["other"] += -flt(m.qty)
				p["other_value"] += -flt(m.value)

	codes = set(opening) | set(closing) | set(per)
	items = _items(codes)
	rows = []
	for code in codes:
		item = items.get(code)
		if not item:
			continue
		o, c, p = opening.get(code, (0, 0, 0))[0], closing.get(code, (0, 0, 0)), per.get(code) or {}
		received, dispensed, other = flt(p.get("received")), flt(p.get("dispensed")), flt(p.get("other"))
		adjust = c[0] - o - received + dispensed + other  # counts and corrections: whatever the movements do not explain
		if not (o or c[0] or received or dispensed or other or adjust):
			continue
		rows.append(
			{
				"item": code,
				"item_name": item.item_name,
				"group": item.item_group,
				"uom": item.stock_uom,
				"opening": round(o, 3),
				"received": round(received, 3),
				"dispensed": round(dispensed, 3),
				"other": round(other, 3),
				"adjustment": round(adjust, 3),
				"closing": round(c[0], 3),
				"closing_value": round(c[2], 2),
				"received_value": round(flt(p.get("received_value")), 2),
				"dispensed_value": round(flt(p.get("dispensed_value")), 2),
			}
		)
	rows.sort(key=lambda r: (r["group"] or "", (r["item_name"] or "").lower()))

	vouchers = {m.voucher_no for m in receipts}
	suppliers = {}
	if vouchers:
		for v, s in frappe.db.sql(
			"SELECT name, supplier FROM `tabPurchase Receipt` WHERE name IN %(n)s UNION ALL SELECT name, supplier FROM `tabPurchase Invoice` WHERE name IN %(n)s",
			{"n": list(vouchers)},
		):
			suppliers[v] = s
	recv = [
		{
			"date": str(m.date),
			"voucher": m.voucher_no,
			"type": m.voucher_type,
			"source": suppliers.get(m.voucher_no) or ("Stock Entry" if m.voucher_type == "Stock Entry" else m.voucher_type),
			"item": items[m.item_code].item_name if m.item_code in items else m.item_code,
			"uom": items[m.item_code].stock_uom if m.item_code in items else "",
			"qty": round(flt(m.qty), 3),
			"rate": round(flt(m.value) / flt(m.qty), 2) if flt(m.qty) else 0,
			"value": round(flt(m.value), 2),
		}
		for m in receipts
	]
	return {
		"warehouse": warehouse,
		"month": first.strftime("%Y-%m"),
		"from": str(first),
		"to": str(last),
		"rows": rows,
		"receipts": recv,
		"kpis": {
			"items_received": len({r["item"] for r in recv}),
			"received_value": round(sum(r["received_value"] for r in rows), 2),
			"dispensed_value": round(sum(r["dispensed_value"] for r in rows), 2),
			"closing_value": round(sum(r["closing_value"] for r in rows), 2),
			"items_moved": sum(1 for r in rows if r["received"] or r["dispensed"] or r["other"]),
		},
	}


# ------------------------------------------------------------------ cost analysis
def cost_analysis(from_date=None, to_date=None):
	"""What the clinic's drugs cost over a period: value dispensed, by drug group, drug, department and month; plus purchases."""
	warehouse = _warehouse()
	end_day = getdate(to_date) if to_date else getdate(nowdate())
	start_day = getdate(from_date) if from_date else get_first_day(end_day)
	if start_day > end_day:
		start_day, end_day = end_day, start_day
	a, b = f"{start_day} 00:00:00", _stamp(end_day)

	issued = frappe.db.sql(
		"""SELECT s.item_code, s.voucher_no, s.posting_date AS date, -s.actual_qty AS qty, -s.stock_value_difference AS cost,
			IFNULL(se.remarks, '') AS remarks, d.name AS dispensing, d.patient, cp.department
		FROM `tabStock Ledger Entry` s
		JOIN `tabStock Entry` se ON se.name = s.voucher_no AND s.voucher_type = 'Stock Entry'
		LEFT JOIN `tabClinic Dispensing` d ON d.stock_entry = se.name
		LEFT JOIN `tabClinic Patient` cp ON cp.name = d.patient
		WHERE s.warehouse = %(w)s AND s.is_cancelled = 0 AND s.actual_qty < 0 AND s.posting_datetime BETWEEN %(a)s AND %(b)s""",
		{"w": warehouse, "a": a, "b": b},
		as_dict=True,
	)
	dispensed = [r for r in issued if r.remarks.startswith("Dispensed at the clinic")]
	other = [r for r in issued if not r.remarks.startswith("Dispensed at the clinic")]
	bought = frappe.db.sql(
		"""SELECT s.item_code, SUM(s.actual_qty) AS qty, SUM(s.stock_value_difference) AS value FROM `tabStock Ledger Entry` s
		WHERE s.warehouse = %(w)s AND s.is_cancelled = 0 AND s.actual_qty > 0 AND s.voucher_type IN %(v)s AND s.posting_datetime BETWEEN %(a)s AND %(b)s
		GROUP BY s.item_code""",
		{"w": warehouse, "a": a, "b": b, "v": RECEIPT_VOUCHERS},
		as_dict=True,
	)
	items = _items({r.item_code for r in issued} | {r.item_code for r in bought})
	opening = _balances(warehouse, _stamp(add_days(start_day, -1)))
	closing = _balances(warehouse, b)

	def name(code):
		return items[code].item_name if code in items else code

	def group(code):
		return (items[code].item_group if code in items else None) or "Other"

	total = sum(flt(r.cost) for r in dispensed)
	by_item, by_group, by_dept, by_month = {}, defaultdict(float), defaultdict(float), defaultdict(float)
	for r in dispensed:
		x = by_item.setdefault(r.item_code, {"item": name(r.item_code), "group": group(r.item_code), "uom": items[r.item_code].stock_uom if r.item_code in items else "", "qty": 0.0, "cost": 0.0})
		x["qty"] += flt(r.qty)
		x["cost"] += flt(r.cost)
		by_group[group(r.item_code)] += flt(r.cost)
		by_dept[r.department or "Not recorded"] += flt(r.cost)
		by_month[str(r.date)[:7]] += flt(r.cost)
	dispensings = {r.dispensing or r.voucher_no for r in dispensed}
	people = {r.patient for r in dispensed if r.patient}
	months, cursor = [], get_first_day(start_day)
	while cursor <= end_day:
		months.append(cursor.strftime("%Y-%m"))
		cursor = add_months(cursor, 1)

	def pct(v):
		return round(v * 100 / total, 1) if total else 0

	purchases = round(sum(flt(r.value) for r in bought), 2)
	return {
		"warehouse": warehouse,
		"from": str(start_day),
		"to": str(end_day),
		"kpis": {
			"dispensed_cost": round(total, 2),
			"dispensings": len(dispensings),
			"employees": len(people),
			"avg_per_dispensing": round(total / len(dispensings), 2) if dispensings else 0,
			"cost_per_employee": round(total / len(people), 2) if people else 0,
			"purchases": purchases,
			"other_issues": round(sum(flt(r.cost) for r in other), 2),
			"opening_value": round(sum(v[2] for v in opening.values()), 2),
			"closing_value": round(sum(v[2] for v in closing.values()), 2),
			"unpriced_items": sum(1 for x in by_item.values() if x["qty"] and not x["cost"]),
		},
		"by_group": sorted(
			[{"group": g, "cost": round(v, 2), "percent": pct(v)} for g, v in by_group.items()], key=lambda r: -r["cost"]
		),
		"by_item": sorted(
			[{**x, "qty": round(x["qty"], 3), "cost": round(x["cost"], 2), "unit_cost": round(x["cost"] / x["qty"], 2) if x["qty"] else 0, "percent": pct(x["cost"])} for x in by_item.values()],
			key=lambda r: -r["cost"],
		),
		"by_department": sorted(
			[{"department": d, "cost": round(v, 2), "percent": pct(v)} for d, v in by_dept.items()], key=lambda r: -r["cost"]
		),
		"by_month": [{"month": m, "cost": round(by_month.get(m, 0), 2)} for m in months],
		"purchases": sorted(
			[{"item": name(r.item_code), "uom": items[r.item_code].stock_uom if r.item_code in items else "", "qty": round(flt(r.qty), 3), "value": round(flt(r.value), 2)} for r in bought],
			key=lambda r: -r["value"],
		),
	}


@frappe.whitelist()
def report(name, as_of=None, month=None, from_date=None, to_date=None):
	"""One call for the printable reports: the figures plus the letterhead details."""
	_guard()
	if name == "stock_balance":
		data = stock_balance(as_of)
	elif name == "stock_movement":
		data = stock_movement(month)
	elif name == "cost_analysis":
		data = cost_analysis(from_date, to_date)
	else:
		frappe.throw(_("Unknown report {0}").format(name))
	return _info(report=name, data=data)
