import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime, nowdate

from clinic import stock
from clinic.clinic.doctype.clinic_visit.clinic_visit import CLOSED_STATUSES, set_visit_status
from clinic.seed_data import MEDICAL_EXAM_TESTS

MEDICAL_TYPES = ("Pre-Employment Medical", "Post-Employment Medical")


class ClinicConsultation(Document):
	def validate(self):
		self.validate_visit()
		self.set_from_visit()
		self.set_from_triage()
		self.validate_referral_and_follow_up()
		self.validate_employee_fields()
		self.validate_prescriptions()

	def after_insert(self):
		frappe.db.set_value("Clinic Visit", self.visit, "consultation", self.name)
		set_visit_status(self.visit, "In Consultation")

	# ------------------------------------------------------------ validation
	def validate_visit(self):
		if not self.is_new():
			return
		status = frappe.db.get_value("Clinic Visit", self.visit, "status")
		if status in CLOSED_STATUSES:
			frappe.throw(_("Visit {0} is {1}").format(self.visit, status))
		existing = frappe.db.exists("Clinic Consultation", {"visit": self.visit})
		if existing:
			frappe.throw(_("Consultation {0} already exists for this visit").format(existing))

	def set_from_visit(self):
		self.consultation_type = frappe.db.get_value("Clinic Visit", self.visit, "visit_purpose") or "Consultation"
		if self.is_new() and self.consultation_type in MEDICAL_TYPES and not self.medical_tests:
			for test in MEDICAL_EXAM_TESTS:
				self.append("medical_tests", {"test": test})

	def set_from_triage(self):
		self.triage = frappe.db.get_value("Clinic Visit", self.visit, "triage")
		if not self.triage:
			self.vitals_summary = None
			return
		t = frappe.db.get_value(
			"Clinic Triage",
			self.triage,
			[
				"bp_systolic", "bp_diastolic", "pulse_rate", "temperature", "spo2",
				"respiratory_rate", "weight_kg", "height_cm", "bmi", "chief_complaint", "alerts",
			],
			as_dict=True,
		)
		parts = []
		if t.bp_systolic:
			parts.append(f"BP {t.bp_systolic}/{t.bp_diastolic} mmHg")
		for label, value, unit in (
			("Pulse", t.pulse_rate, "bpm"),
			("Temp", t.temperature, "°C"),
			("SpO₂", t.spo2, "%"),
			("RR", t.respiratory_rate, "/min"),
			("Weight", t.weight_kg, "kg"),
			("Height", t.height_cm, "cm"),
			("BMI", t.bmi, ""),
		):
			if value:
				parts.append(f"{label} {value} {unit}".strip())
		self.vitals_summary = " | ".join(parts)
		if t.alerts:
			self.vitals_summary += "\n" + _("Alerts: ") + t.alerts.replace("\n", "; ")

		if self.is_new():
			self.presenting_complaint = self.presenting_complaint or t.chief_complaint
			if not self.drug_allergies:
				self.drug_allergies = frappe.db.get_value("Clinic Patient", self.patient, "allergies")

	def validate_referral_and_follow_up(self):
		if not self.refer_out:
			self.referral_facility = self.referral_reason = self.referral_notes = None
		if self.follow_up_required:
			if not self.appointment and getdate(self.follow_up_date) < getdate(nowdate()):
				frappe.throw(_("Follow-up date cannot be in the past"))
		elif not self.appointment:
			self.follow_up_date = self.follow_up_reason = None

	def validate_employee_fields(self):
		if self.patient_type != "Employee":
			self.sick_leave_days = self.light_duty_days = 0
			self.work_related = 0
		if self.consultation_type not in MEDICAL_TYPES:
			self.fitness_status = self.job_position = self.fitness_restrictions = None
			self.certificate_valid_until = self.medical_remarks = None
			self.medical_tests = []

	def validate_prescriptions(self):
		for row in self.prescriptions:
			if (row.quantity or 0) <= 0:
				frappe.throw(_("Row {0}: quantity for {1} must be greater than zero").format(row.idx, row.drug))
		self.validate_stock()

	def validate_stock(self):
		"""Only what is on the pharmacy shelf (and not already promised to another patient) can be prescribed."""
		if self.dispensing and frappe.db.get_value("Clinic Dispensing", self.dispensing, "docstatus") == 1:
			return  # already dispensed: stock has been issued
		wanted = {}
		for row in self.prescriptions:
			wanted[row.drug] = wanted.get(row.drug, 0) + (row.quantity or 0)
		free = stock.available(list(wanted), exclude_consultation=self.name)
		for drug, qty in wanted.items():
			if qty > free.get(drug, 0):
				name = frappe.db.get_value("Item", drug, "item_name") or drug
				frappe.throw(
					_("Only {0} of {1} is available at the pharmacy; you prescribed {2}.").format(free.get(drug, 0), name, qty)
				)

	# ------------------------------------------------------------ actions
	@frappe.whitelist()
	def send_to_pharmacy(self):
		self.check_permission("write")
		if not self.prescriptions:
			frappe.throw(_("Add at least one prescription item first"))
		if self.dispensing and frappe.db.get_value("Clinic Dispensing", self.dispensing, "docstatus") != 2:
			frappe.throw(_("Already sent to pharmacy ({0})").format(self.dispensing))
		self.validate_ready_to_close()

		dispensing = frappe.get_doc(
			{
				"doctype": "Clinic Dispensing",
				"visit": self.visit,
				"consultation": self.name,
				"items": [
					{
						"drug": row.drug,
						"dose": row.dose,
						"route": row.route,
						"frequency": row.frequency,
						"duration_days": row.duration_days,
						"prescribed_qty": row.quantity,
						"dispensed_qty": row.quantity,
						"instructions": row.instructions,
					}
					for row in self.prescriptions
				],
			}
		).insert()
		self.dispensing = dispensing.name
		self.finalise("Waiting Pharmacy")

	@frappe.whitelist()
	def complete_consultation(self):
		self.check_permission("write")
		if self.prescriptions and not self.dispensing:
			frappe.throw(_("There are prescriptions on this consultation. Use Send to Pharmacy."))
		self.validate_ready_to_close()
		self.finalise("Completed")

	def validate_ready_to_close(self):
		if self.consultation_type in MEDICAL_TYPES:
			if not self.fitness_status:
				frappe.throw(_("Record the fitness outcome on the Medical Examination tab before closing"))
		elif not self.diagnoses:
			frappe.throw(_("Add at least one diagnosis before closing the consultation"))

	def finalise(self, visit_status):
		self.create_follow_up_appointment()
		self.status = "Completed"
		if not self.ended_on:  # the first time it is closed; reopening for results does not move it
			self.ended_on = now_datetime()
		self.save()
		set_visit_status(self.visit, visit_status)

	def create_follow_up_appointment(self):
		if not self.follow_up_required or self.appointment:
			return
		appointment = frappe.get_doc(
			{
				"doctype": "Clinic Appointment",
				"patient": self.patient,
				"appointment_date": self.follow_up_date,
				"appointment_type": "Follow-up",
				"reason": self.follow_up_reason,
				"source_consultation": self.name,
			}
		).insert()
		self.appointment = appointment.name
