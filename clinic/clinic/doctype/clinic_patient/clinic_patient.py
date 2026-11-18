import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import formatdate, getdate, nowdate

from clinic.utils import age_text


class ClinicPatient(Document):
	def onload(self):
		self.age = age_text(self.date_of_birth)

	def before_validate(self):
		# set before Frappe fetches the employer's billing flags onto the patient
		if self.patient_type == "Employee" and not self.employer:
			self.employer = frappe.db.get_value("Clinic Employer", {"uses_employee_records": 1}, "name")

	def validate(self):
		self.validate_date_of_birth()
		self.validate_type_fields()
		self.validate_dependant()
		self.age = age_text(self.date_of_birth)

	def validate_date_of_birth(self):
		if self.date_of_birth and getdate(self.date_of_birth) > getdate(nowdate()):
			frappe.throw(
				_("Date of birth {0} is in the future. Check the day and month are the right way round.").format(
					formatdate(self.date_of_birth)
				)
			)

	def on_update(self):
		"""A corrected date of birth must re-date the child's immunization card."""
		if self.has_value_changed("date_of_birth") and not self.is_new():
			child = frappe.db.get_value("Clinic Child Record", {"patient": self.name}, "name")
			if child:
				frappe.get_doc("Clinic Child Record", child).save(ignore_permissions=True)

	def validate_type_fields(self):
		if self.patient_type == "Employee":
			# Staff of the farm that owns the system come from the Employee list; other farms' staff are typed in
			if not self.employer:
				frappe.throw(_("Select the employee's farm"))
			if frappe.db.get_value("Clinic Employer", self.employer, "uses_employee_records"):
				if not self.employee:
					frappe.throw(_("Select the employee from the Employee list"))
				self.staff_no = self.section = None
				duplicate = frappe.db.exists("Clinic Patient", {"employee": self.employee, "name": ["!=", self.name]})
				if duplicate:
					frappe.throw(
						_("Employee {0} is already registered as patient {1}").format(self.employee, duplicate)
					)
			else:
				self.employee = self.department = None
				if self.staff_no:
					duplicate = frappe.db.exists(
						"Clinic Patient",
						{"employer": self.employer, "staff_no": self.staff_no, "name": ["!=", self.name]},
					)
					if duplicate:
						frappe.throw(
							_("Staff no. {0} at {1} is already registered as patient {2}").format(
								self.staff_no, self.employer, duplicate
							)
						)
			self.village = None
		else:
			self.employee = self.department = self.employer = self.staff_no = self.section = None

	def validate_dependant(self):
		"""A dependant is a community member whose bills go to the farm their parent works for."""
		if self.patient_type != "Community Member" or not self.is_dependant:
			self.is_dependant = 0
			self.dependant_farm = self.dependant_relationship = self.parent_employee = self.parent_patient = self.parent_name = None
			return
		if not self.dependant_farm:
			frappe.throw(_("Select the farm the employee (parent / guardian) works for"))
		if frappe.db.get_value("Clinic Employer", self.dependant_farm, "uses_employee_records"):
			if not self.parent_employee:
				frappe.throw(_("Select the employee this dependant belongs to"))
			self.parent_patient = None
			self.parent_name = frappe.db.get_value("Employee", self.parent_employee, "employee_name")
		else:
			if not self.parent_patient:
				frappe.throw(_("Select the employee this dependant belongs to, or add them"))
			parent = frappe.db.get_value("Clinic Patient", self.parent_patient, ["patient_type", "employer", "full_name"], as_dict=True)
			if parent.patient_type != "Employee" or parent.employer != self.dependant_farm:
				frappe.throw(_("{0} is not registered as an employee of {1}").format(parent.full_name, self.dependant_farm))
			self.parent_employee = None
			self.parent_name = parent.full_name


@frappe.whitelist()
def add_parent_employee(farm, full_name, staff_no=None, phone=None, national_id=None, sex=None):
	"""Register an employee of another farm on the spot, so a dependant can be linked to them."""
	frappe.has_permission("Clinic Patient", "create", throw=True)
	if frappe.db.get_value("Clinic Employer", farm, "uses_employee_records"):
		frappe.throw(_("Staff of {0} are picked from the Employee list").format(farm))
	if not (full_name or "").strip():
		frappe.throw(_("Enter the employee's name"))
	doc = frappe.get_doc({
		"doctype": "Clinic Patient", "patient_type": "Employee", "employer": farm, "full_name": full_name.strip(),
		"staff_no": (staff_no or "").strip() or None, "phone": phone or None, "national_id": national_id or None, "sex": sex or None,
	})
	doc.insert()
	return {"name": doc.name, "full_name": doc.full_name}
