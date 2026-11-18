import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

from clinic import billing
from clinic.clinic.doctype.clinic_visit.clinic_visit import set_visit_status


class ClinicDispensing(Document):
	def validate(self):
		for row in self.items:
			if (row.dispensed_qty or 0) < 0:
				frappe.throw(_("Row {0}: dispensed quantity cannot be negative").format(row.idx))
			if row.not_available:
				row.dispensed_qty = 0  # not in stock: nothing is handed out or charged

	def on_update(self):
		if self.docstatus == 0:
			billing.sync_drug_charges(self)

	def before_submit(self):
		if not any(row.dispensed_qty or row.not_available for row in self.items):
			frappe.throw(_("Nothing has been dispensed. Enter dispensed quantities before submitting."))
		self.dispensed_on = now_datetime()
		self.pharmacist = frappe.session.user

	def on_submit(self):
		set_visit_status(self.visit, "Completed")
		self.reduce_stock()

	def on_cancel(self):
		if self.stock_entry and frappe.db.get_value("Stock Entry", self.stock_entry, "docstatus") == 1:
			frappe.get_doc("Stock Entry", self.stock_entry).cancel()

	def reduce_stock(self):
		"""Take what was handed out from the Clinic Store. Dispensing is never blocked by stock: a drug the
		store does not hold enough of is only taken out as far as the store has it, and the shortfall is noted."""
		warehouse = frappe.db.get_single_value("Clinic Settings", "store_warehouse")
		if not warehouse or not frappe.db.exists("Warehouse", warehouse):
			return
		wanted = {}
		for row in self.items:
			if row.drug and flt(row.dispensed_qty) > 0 and not row.not_available:
				wanted[row.drug] = wanted.get(row.drug, 0) + flt(row.dispensed_qty)
		lines, short = [], []
		for drug, qty in wanted.items():
			uom = frappe.db.get_value("Item", drug, ["stock_uom", "is_stock_item"], as_dict=True)
			if not uom or not uom.is_stock_item:
				continue
			have = flt(frappe.db.get_value("Bin", {"item_code": drug, "warehouse": warehouse}, "actual_qty"))
			take = min(qty, max(have, 0))
			if take < qty:
				short.append(f"{drug}: dispensed {qty:g}, store had {have:g}")
			if take > 0:
				lines.append({"item_code": drug, "qty": take, "uom": uom.stock_uom, "stock_uom": uom.stock_uom, "conversion_factor": 1, "s_warehouse": warehouse, "allow_zero_valuation_rate": 1})
		if lines:
			try:
				frappe.db.savepoint("clinic_store_issue")
				se = frappe.get_doc({
					"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "purpose": "Material Issue",
					"company": frappe.db.get_value("Warehouse", warehouse, "company"), "from_warehouse": warehouse,
					"remarks": _("Dispensed to {0} ({1})").format(self.patient_name or self.patient, self.name), "items": lines,
				})
				se.insert(ignore_permissions=True)
				se.submit()
				self.db_set("stock_entry", se.name, update_modified=False)
			except Exception:
				frappe.db.rollback(save_point="clinic_store_issue")
				frappe.log_error(title="Clinic Store stock issue failed", message=frappe.get_traceback())
				short.append(_("The store could not be updated (see Error Log)"))
		if short:
			self.add_comment("Comment", _("Stock not fully reduced:") + "\n" + "\n".join(short))
