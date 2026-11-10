import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowdate


class ClinicIncident(Document):
	def validate(self):
		if self.incident_date and getdate(self.incident_date) > getdate(nowdate()):
			frappe.throw(_("The date of the event cannot be in the future"))
		p = frappe.db.get_value(
			"Clinic Patient", self.patient, ["full_name", "patient_type", "department", "employer"], as_dict=True
		)
		if p:
			self.patient_name, self.patient_type = p.full_name, p.patient_type
			self.department, self.employer = p.department, p.employer
		if self.visit and not self.consultation:
			self.consultation = frappe.db.get_value("Clinic Visit", self.visit, "consultation")
		if not self.doctor:
			self.doctor = frappe.session.user
		if self.outcome != "Sick-off":
			self.lost_days = cint(self.lost_days) if self.outcome in ("Light duty", "Referred out", "Admitted") else 0
		if self.severity in ("Severe", "Fatal") and self.work_related and self.doshmis_status == "Not Required":
			self.doshmis_status = "Pending"  # serious work injuries must be reported to DOSHS

	def after_insert(self):
		self.flag_consultation()

	def on_update(self):
		self.flag_consultation()

	def flag_consultation(self):
		"""A work-related event marks the consultation as a work-related case."""
		if self.consultation and self.work_related:
			frappe.db.set_value("Clinic Consultation", self.consultation, "work_related", 1, update_modified=False)
