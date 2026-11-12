import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate, nowdate

from clinic.clinic.doctype.clinic_visit.clinic_visit import CLOSED_STATUSES, set_visit_status
from clinic import billing
from clinic.encounter import check_tb_test_sent, request_tb_test
from clinic.seed_data import MEDICAL_EXAM_TESTS

MEDICAL_TYPES = ("Pre-Employment Medical", "Post-Employment Medical")

TB_SCREENING = {
	1: "1 - Presumed TB",
	2: "2 - No Signs",
	3: "3 - On TB Treatment",
	4: "4 - Not Done",
}

PENDING_LAB_STATUSES = ["Requested", "Sample Collected"]


class ClinicConsultation(Document):
	def onload(self):
		for row in self.lab_requests:
			if row.lab_test:
				row.lab_status, row.result = frappe.db.get_value(
					"Clinic Lab Test", row.lab_test, ["status", "interpretation"]
				)

	def validate(self):
		self.validate_visit()
		self.set_from_visit()
		self.set_from_triage()
		self.validate_referral_and_follow_up()
		self.validate_employee_fields()
		self.validate_prescriptions()
		self.tb_screening_code = cint((self.tb_screening or "0")[:1])

	def after_insert(self):
		frappe.db.set_value("Clinic Visit", self.visit, "consultation", self.name)
		set_visit_status(self.visit, "In Consultation")
		billing.add_consultation_fee(self)

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
		"""Pre- and post-employment medicals open with the standard examination checklist."""
		self.consultation_type = frappe.db.get_value("Clinic Visit", self.visit, "visit_purpose") or "Consultation"
		if self.consultation_type not in ("Consultation",) + MEDICAL_TYPES:
			self.consultation_type = "Consultation"
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
			self.occupational_history = None
		if self.consultation_type not in MEDICAL_TYPES:
			self.fitness_status = self.job_position = self.fitness_restrictions = None
			self.certificate_valid_until = self.medical_remarks = None
			self.medical_tests = []

	def validate_prescriptions(self):
		for row in self.prescriptions:
			if (row.quantity or 0) <= 0:
				frappe.throw(_("Row {0}: quantity for {1} must be greater than zero").format(row.idx, row.drug))

	# ------------------------------------------------------------ actions
	@frappe.whitelist()
	def set_tb_screening(self, code):
		"""Record the mandatory TB screening. 'Presumed TB' raises the sputum test straight away."""
		self.check_permission("write")
		code = cint(code)
		if code not in TB_SCREENING:
			frappe.throw(_("Choose one of the four TB screening options"))
		self.tb_screening = TB_SCREENING[code]
		if code == 1:
			request_tb_test(self)
		self.save()

	@frappe.whitelist()
	def send_to_lab(self):
		self.check_permission("write")
		new_requests = [row for row in self.lab_requests if not row.lab_test]
		if not new_requests:
			frappe.throw(_("Add at least one new lab request first"))

		for row in new_requests:
			test = frappe.get_doc(
				{
					"doctype": "Clinic Lab Test",
					"visit": self.visit,
					"consultation": self.name,
					"test_type": row.test_type,
					"urgency": row.urgency,
					"clinical_notes": row.clinical_notes,
				}
			).insert()
			row.lab_test = test.name

		self.status = "Awaiting Lab"
		self.save()
		set_visit_status(self.visit, "Waiting Lab")

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
		if not self.tb_screening:
			frappe.throw(_("Record the TB screening (1-4) before closing the consultation"))
		check_tb_test_sent(self)
		if self.consultation_type in MEDICAL_TYPES:
			if not self.fitness_status:
				frappe.throw(_("Record the fitness outcome on the Medical Examination tab before closing"))
		elif not self.diagnoses and not (self.impression or "").strip():
			frappe.throw(_("Add a diagnosis, or write your impression, before closing the consultation"))
		pending = frappe.db.count(
			"Clinic Lab Test", {"visit": self.visit, "status": ["in", PENDING_LAB_STATUSES]}
		)
		if pending:
			frappe.throw(_("{0} lab test(s) are still awaiting results").format(pending))

	def finalise(self, visit_status):
		self.create_follow_up_appointment()
		self.status = "Completed"
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
