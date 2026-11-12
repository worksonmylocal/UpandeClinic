"""Charges for visits.

Everyone is charged the same prices (Clinic Pricing). How they settle differs:
  * Cash    - community members (and staff of employers not on credit) pay at the pharmacy, with a receipt.
  * Invoice - staff of the farms get an invoice to take back to the farm, which pays later.

An open bill is always rebuilt from what actually happened in the visit (consultation, tests done, drugs
dispensed) using the current prices, so nothing depends on the order things were done or when prices were entered.
"""

import frappe
from frappe import _
from frappe.model.naming import make_autoname
from frappe.utils import flt, now_datetime

ORDER = {"Consultation": 0, "Visit Fee": 1, "Procedure": 2, "Lab Test": 3, "Drug": 4}


# ---------------------------------------------------------------- prices
def _pricing():
	return frappe.get_single("Clinic Pricing")


def consultation_price(consultation_type=None):
	"""The doctor's fee. Employment medicals have their own price; when it is left at 0 the normal fee applies."""
	pricing = _pricing()
	special = {"Pre-Employment Medical": pricing.get("pre_employment_medical"), "Post-Employment Medical": pricing.get("post_employment_medical")}.get(consultation_type)
	return flt(special) or flt(pricing.consultation_price)


def lab_price(test_type):
	return next((flt(r.price) for r in _pricing().lab_prices if r.test_type == test_type), 0.0)


def procedure_prices():
	return {r.procedure: flt(r.price) for r in _pricing().procedure_prices}


def drug_courses():
	"""{drug: (price, units in a course/pack)}. The price covers the whole course or pack."""
	return {r.drug: (flt(r.price), flt(r.course_qty) or 1.0) for r in _pricing().drug_prices}


def drug_info():
	"""{drug: {price, course_qty, strength}} for the medicine search."""
	return {r.drug: {"price": flt(r.price), "course_qty": flt(r.course_qty) or 1.0, "strength": r.strength} for r in _pricing().drug_prices}


def drug_prices():
	"""{drug: price per single unit}, for showing a running total at the pharmacy."""
	return {drug: price / course for drug, (price, course) in drug_courses().items()}


def visit_fee(attendance):
	"""(description, amount) the clinic charges for this attendance, or None. Family planning and TB carry no visit fee."""
	pricing = _pricing()
	service = attendance.service_type
	if service == "CWC Attendance":
		first, kind = attendance.cwc_visit_kind != "Revisit", _("MCH clinic")
		amount = pricing.mch_first_visit if first else pricing.mch_revisit
	elif service == "Postnatal Attendance":
		first, kind = (attendance.postnatal_visit_no or 1) <= 1, _("MCH clinic (postnatal)")
		amount = pricing.mch_first_visit if first else pricing.mch_revisit
	elif service == "ANC Attendance":
		first, kind = attendance.anc_visit_kind != "Revisit", _("Antenatal clinic")
		amount = pricing.anc_first_visit if first else pricing.anc_revisit
	else:
		return None
	return (_("{0} visit fee ({1})").format(kind, _("first visit") if first else _("revisit")), flt(amount))


# a family planning removal is a procedure the clinic charges for, whether or not the nurse also lists it
FP_REMOVALS = (
	("implant1_action", "Norplan removal"), ("implant2_action", "Norplan removal"),
	("iucd_copper_action", "IUCD removal"), ("iucd_hormonal_action", "IUCD removal"),
)


# ---------------------------------------------------------------- how a visit is billed
def terms(visit):
	"""Billing mode and sick sheet need for a visit, read live from the patient's employer."""
	return terms_for_patient(frappe.db.get_value("Clinic Visit", visit, "patient"))


def terms_for_patient(patient):
	p = frappe.db.get_value("Clinic Patient", patient, ["patient_type", "employer"], as_dict=True)
	employer = (
		frappe.db.get_value("Clinic Employer", p.employer, ["requires_sick_sheet", "billed_at_clinic"], as_dict=True)
		if p.employer
		else None
	)
	is_staff = p.patient_type == "Employee" and employer
	return {
		"billing_mode": "Invoice" if is_staff and employer.billed_at_clinic else "Cash",
		"sick_sheet": bool(is_staff and employer.requires_sick_sheet),
		"employer": p.employer,
	}


def get_bill(visit, create=False):
	name = frappe.db.get_value("Clinic Bill", {"visit": visit, "status": ["!=", "Cancelled"]}, "name")
	if name:
		return frappe.get_doc("Clinic Bill", name)
	if create:
		bill = frappe.get_doc({"doctype": "Clinic Bill", "visit": visit, "billing_mode": terms(visit)["billing_mode"]})
		bill.insert(ignore_permissions=True)
		return bill
	return None


def _save(bill):
	bill.flags.ignore_permissions = True
	bill.save()
	return bill


# ---------------------------------------------------------------- building the bill
def desired_lines(visit):
	"""{(source doctype, source name): (type, description, qty, rate)} for everything chargeable so far."""
	lines = {}
	consultation = frappe.db.get_value("Clinic Visit", visit, "consultation")
	if consultation:
		kind = frappe.db.get_value("Clinic Consultation", consultation, "consultation_type") or "Consultation"
		label = _("Consultation fee") if kind == "Consultation" else _(kind)
		lines[("Clinic Consultation", consultation)] = ("Consultation", label, 1, consultation_price(kind))
	attendance_name = frappe.db.get_value("Clinic Visit", visit, "attendance")
	procedures = procedure_prices()
	if consultation:
		for row in frappe.get_all("Clinic Procedure Done", filters={"parent": consultation, "parenttype": "Clinic Consultation"}, fields=["name", "procedure", "qty"]):
			lines[("Clinic Procedure Done", row.name)] = ("Procedure", row.procedure, row.qty or 1, procedures.get(row.procedure, 0))
	if attendance_name:
		att = frappe.get_doc("Clinic Attendance", attendance_name)
		if att.status == "Completed":  # charged once the attendance is closed (or handed to the doctor)
			fee = visit_fee(att)
			if fee:
				lines[("Clinic Attendance", att.name)] = ("Visit Fee", fee[0], 1, fee[1])
			for row in att.procedures:
				lines[("Clinic Procedure Done", row.name)] = ("Procedure", row.procedure, row.qty or 1, procedures.get(row.procedure, 0))
			if att.service_type == "Family Planning":
				done = set()
				for field, procedure in FP_REMOVALS:
					if att.get(field) in ("Removed", "Replaced") and procedure not in done and not any(r.procedure == procedure for r in att.procedures):
						done.add(procedure)
						lines[("Clinic Attendance", f"{att.name}:{procedure}")] = ("Procedure", procedure, 1, procedures.get(procedure, 0))
	for test in frappe.get_all(
		"Clinic Lab Test",
		filters={"visit": visit, "status": ["in", ["Resulted", "Sent to External"]]},
		fields=["name", "test_type"],
	):
		lines[("Clinic Lab Test", test.name)] = ("Lab Test", test.test_type, 1, lab_price(test.test_type))
	dispensing = frappe.db.get_value("Clinic Dispensing", {"visit": visit, "docstatus": ["!=", 2]}, "name", order_by="creation desc")
	if dispensing:
		courses = drug_courses()
		for row in frappe.get_all(
			"Clinic Dispensing Item",
			filters={"parent": dispensing},
			fields=["name", "drug", "drug_name", "dispensed_qty", "not_available"],
		):
			qty = 0 if row.not_available else flt(row.dispensed_qty)
			price, course = courses.get(row.drug, (0.0, 1.0))
			name = row.drug_name or row.drug
			if course > 1:  # the price is for a whole course: a part course is charged pro rata
				lines[("Clinic Dispensing Item", row.name)] = ("Drug", f"{name} (x{qty:g})", 1, round(price * qty / course, 2))
			else:
				lines[("Clinic Dispensing Item", row.name)] = ("Drug", name, qty, price)
	# tests without a price and drugs that carry no charge simply do not appear on the bill
	return {key: line for key, line in lines.items() if flt(line[2]) > 0 and flt(line[3]) > 0}


def rebuild(bill):
	"""Bring an open bill in line with the visit. Invoiced and paid bills are never touched."""
	if bill.status != "Open":
		return bill
	want = desired_lines(bill.visit)
	have = {(r.reference_doctype, r.reference_name): r for r in bill.items}
	changed = False
	for key, row in list(have.items()):
		if key not in want:
			bill.remove(row)
			changed = True
	for key, (item_type, description, qty, rate) in want.items():
		row = have.get(key)
		if row is None:
			bill.append(
				"items",
				{
					"item_type": item_type, "description": description, "qty": qty, "rate": rate,
					"reference_doctype": key[0], "reference_name": key[1],
				},
			)
			changed = True
		elif (row.description, flt(row.qty), flt(row.rate)) != (description, flt(qty), flt(rate)):
			row.description, row.qty, row.rate = description, qty, rate
			changed = True
	if changed:
		_save(bill)
	return bill


def sync(visit, create=True):
	bill = get_bill(visit, create=create)
	return rebuild(bill) if bill else None


# hooks used by the consultation, lab test and dispensing records
def add_consultation_fee(consultation):
	sync(consultation.visit)


def sync_lab_charge(test):
	conducted = test.status in ("Resulted", "Sent to External")
	sync(test.visit, create=conducted)


def sync_drug_charges(dispensing):
	if dispensing.docstatus != 2:
		sync(dispensing.visit)


# ---------------------------------------------------------------- reading and settling
def has_unpaid_bill(visit):
	bill = get_bill(visit)
	if not bill and desired_lines(visit):
		bill = sync(visit)  # a visit fee or procedure with no drugs or tests still has to be paid
	return bool(bill and bill.status == "Open" and flt(rebuild(bill).total) > 0)


def summary(visit):
	bill = get_bill(visit)
	if not bill:
		return None
	bill = rebuild(bill)
	return {
		"name": bill.name,
		"status": bill.status,
		"billing_mode": bill.billing_mode,
		"total": flt(bill.total),
		"consultation_total": flt(bill.consultation_total),
		"procedure_total": flt(bill.procedure_total),
		"lab_total": flt(bill.lab_total),
		"drug_total": flt(bill.drug_total),
		"receipt_no": bill.receipt_no,
		"invoice_no": bill.invoice_no,
		"lines": [
			{"item_type": r.item_type, "description": r.description, "qty": flt(r.qty), "rate": flt(r.rate), "amount": flt(r.amount)}
			for r in bill.items
		],
	}


def pay(visit, mode, amount, reference=None):
	"""Cash settlement at the pharmacy."""
	bill = get_bill(visit)
	if not bill:
		frappe.throw(_("There is no bill for this visit"))
	if bill.status == "Paid":
		frappe.throw(_("This bill has already been paid (receipt {0})").format(bill.receipt_no))
	if bill.status == "Invoiced":
		frappe.throw(_("This bill was invoiced to the employer ({0})").format(bill.invoice_no))
	if bill.billing_mode == "Invoice":
		frappe.throw(_("This patient's bill goes to the employer as an invoice, not cash"))
	bill = rebuild(bill)
	total, amount = flt(bill.total), flt(amount)
	if total > 0:
		if not mode:
			frappe.throw(_("Choose how the patient is paying"))
		if amount < total:
			frappe.throw(_("Amount received (KSh {0}) is less than the total due (KSh {1})").format(amount, total))
	bill.status = "Paid"
	bill.payment_mode = mode
	bill.amount_paid = amount if total > 0 else 0
	bill.change_amount = max(amount - total, 0) if total > 0 else 0
	bill.payment_reference = reference
	bill.paid_on = now_datetime()
	bill.received_by = frappe.session.user
	bill.receipt_no = make_autoname("REC-.YYYY.-.#####")
	return _save(bill)


def issue_invoice(visit):
	"""Farm staff: the bill becomes an invoice for the employer to settle later."""
	bill = get_bill(visit)
	if not bill:
		frappe.throw(_("There is no bill for this visit"))
	if bill.status == "Invoiced":
		return bill
	if bill.status != "Open":
		frappe.throw(_("This bill is already {0}").format(bill.status))
	if bill.billing_mode != "Invoice":
		frappe.throw(_("This patient pays cash, not on an employer invoice"))
	bill = rebuild(bill)
	if flt(bill.total) <= 0:
		frappe.throw(_("There is nothing to invoice"))
	bill.status = "Invoiced"
	bill.invoice_no = make_autoname("INV-.YYYY.-.#####")
	bill.invoiced_on = now_datetime()
	return _save(bill)


def record_farm_payment(bill_names, mode, reference=None):
	"""The farm has paid one or more invoices."""
	if not mode:
		frappe.throw(_("Choose how the farm paid"))
	paid = []
	for name in bill_names:
		bill = frappe.get_doc("Clinic Bill", name)
		if bill.status != "Invoiced":
			frappe.throw(_("{0} is not an outstanding invoice").format(name))
		bill.status = "Paid"
		bill.payment_mode = mode
		bill.amount_paid = flt(bill.total)
		bill.change_amount = 0
		bill.payment_reference = reference
		bill.paid_on = now_datetime()
		bill.received_by = frappe.session.user
		bill.receipt_no = make_autoname("REC-.YYYY.-.#####")
		_save(bill)
		paid.append(bill.name)
	return paid
