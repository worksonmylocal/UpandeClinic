import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime, nowdate

from clinic import billing
from clinic.clinic.doctype.clinic_visit.clinic_visit import CLOSED_STATUSES, set_visit_status

POSITIVE = {"positive", "reactive", "present", "seen", "detected"}
NEGATIVE = {"negative", "non-reactive", "nonreactive", "absent", "not seen", "not detected", "nil"}
PENDING = ["Requested", "Sample Collected"]


class ClinicLabTest(Document):
	def before_insert(self):
		test_type = frappe.get_cached_doc("Clinic Lab Test Type", self.test_type)
		self.performed_where = test_type.performed_where
		if test_type.performed_where == "External":
			self.external_facility = self.external_facility or test_type.default_external_facility
		if not self.results:
			for p in test_type.parameters:
				self.append(
					"results",
					{
						"parameter": p.parameter,
						"result_type": p.result_type,
						"unit": p.unit,
						"normal_low": p.normal_low,
						"normal_high": p.normal_high,
						"options": p.options,
						"param_group": p.param_group,
					},
				)

	def validate(self):
		self.validate_visit()
		self.evaluate_results()
		self.validate_status()

	def on_update(self):
		billing.sync_lab_charge(self)
		self.sync_visit_status()

	def validate_visit(self):
		if self.is_new():
			status = frappe.db.get_value("Clinic Visit", self.visit, "status")
			if status in CLOSED_STATUSES:
				frappe.throw(_("Visit {0} is {1}").format(self.visit, status))

	def validate_status(self):
		if self.status == "Sample Collected" and not self.sample_collected_on:
			self.sample_collected_on = now_datetime()

		if self.status == "Sent to External":
			if self.performed_where != "External":
				frappe.throw(_("{0} is performed onsite").format(self.test_type))
			if not self.external_facility:
				frappe.throw(_("Select the external facility this test was sent to"))
			self.sent_on = self.sent_on or nowdate()

		if self.status == "Resulted":
			if self.requires_consent and not self.consent_obtained:
				frappe.throw(_("Record patient consent / pre-test counselling before entering results"))
			if self.performed_where == "External" and not (self.external_report or self.has_values()):
				frappe.throw(_("Attach the external report or enter the results"))
			if self.performed_where == "Onsite" and not self.has_values():
				frappe.throw(_("Enter at least one result for {0}").format(self.test_type))
			self.resulted_on = self.resulted_on or now_datetime()
			self.technician = self.technician or frappe.session.user
			if not self.interpretation:
				self.interpretation = self.derive_interpretation()

	def has_values(self):
		return any((r.value or "").strip() for r in self.results)

	def evaluate_results(self):
		for row in self.results:
			value = (row.value or "").strip()
			row.value = value
			row.reference = self.reference_text(row)
			row.flag = self.flag_for(row, value) if value else ""

	@staticmethod
	def reference_text(row):
		if row.result_type == "Numeric" and (row.normal_low or row.normal_high):
			return f"{row.normal_low:g} - {row.normal_high:g}"
		if row.result_type == "Qualitative" and row.options:
			return " / ".join(o.strip() for o in row.options.split("\n") if o.strip())
		return ""

	@staticmethod
	def flag_for(row, value):
		if row.result_type == "Numeric":
			try:
				number = float(value)
			except ValueError:
				frappe.throw(_("{0}: {1} is not a number").format(row.parameter, value))
			if row.normal_low and number < row.normal_low:
				return "Low"
			if row.normal_high and number > row.normal_high:
				return "High"
			return "Normal"

		if row.result_type == "Qualitative":
			allowed = [o.strip() for o in (row.options or "").split("\n") if o.strip()]
			if allowed:
				match = next((o for o in allowed if o.lower() == value.lower()), None)
				if not match:
					frappe.throw(
						_("{0}: '{1}' is not an allowed result. Use one of: {2}").format(
							row.parameter, value, ", ".join(allowed)
						)
					)
				row.value = value = match
			if value.lower() in POSITIVE or value.lower().startswith("positive"):
				return "Positive"
			if value.lower() in NEGATIVE:
				return "Negative"
			if value.startswith("+"):
				return "Abnormal"
		return ""

	def derive_interpretation(self):
		flags = {r.flag for r in self.results if r.flag}
		if "Positive" in flags:
			return "Positive"
		if flags & {"Abnormal", "High", "Low"}:
			return "Abnormal"
		if "Negative" in flags:
			return "Negative"
		if "Normal" in flags:
			return "Normal"
		return ""

	def sync_visit_status(self):
		visit = frappe.db.get_value(
			"Clinic Visit", self.visit, ["status", "visit_purpose", "consultation", "attendance"], as_dict=True
		)
		if not visit or visit.status in CLOSED_STATUSES:
			return
		pending = frappe.db.count("Clinic Lab Test", {"visit": self.visit, "status": ["in", PENDING]})
		if pending:
			set_visit_status(self.visit, "Waiting Lab")
		elif not (visit.consultation or visit.attendance):
			set_visit_status(self.visit, "Completed")
		else:
			set_visit_status(self.visit, "Lab Results Ready")
			for doctype, name in (("Clinic Consultation", visit.consultation), ("Clinic Attendance", visit.attendance)):
				if name and frappe.db.get_value(doctype, name, "status") == "Awaiting Lab":
					frappe.db.set_value(doctype, name, "status", "Open")
