import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ClinicBill(Document):
	def validate(self):
		order = {"Consultation": 0, "Visit Fee": 1, "Procedure": 2, "Lab Test": 3, "Drug": 4}
		self.items.sort(key=lambda r: order.get(r.item_type, 9))
		for i, row in enumerate(self.items, 1):
			row.idx = i
		totals = {"Consultation": 0.0, "Visit Fee": 0.0, "Procedure": 0.0, "Lab Test": 0.0, "Drug": 0.0}
		for row in self.items:
			row.amount = flt(row.qty) * flt(row.rate)
			totals[row.item_type] += row.amount
		self.consultation_total = totals["Consultation"] + totals["Visit Fee"]
		self.procedure_total = totals["Procedure"]
		self.lab_total = totals["Lab Test"]
		self.drug_total = totals["Drug"]
		self.total = 0 if self.waived else sum(totals.values())  # a waived bill is brought back to nothing
