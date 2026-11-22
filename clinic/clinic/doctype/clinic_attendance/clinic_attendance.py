import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, cint, date_diff, getdate, nowdate

from clinic.clinic.doctype.clinic_visit.clinic_visit import CLOSED_STATUSES, set_visit_status
from clinic import stock
from clinic.utils import age_in_months, age_text
from clinic.encounter import (
	check_tb_test_sent,
	create_dispensing,
	create_follow_up,
	create_lab_tests,
	request_tb_test,
)

UNIT_SERVICES = {
	"Antenatal Clinic": ("Family Planning", "ANC Attendance"),
	"MCH & Postnatal Clinic": ("Postnatal Attendance", "CWC Attendance"),
	"TB Clinic": ("TB Registration", "TB Follow-up"),
	"HTS Clinic": ("HTS Attendance",),
}
TB_SCREENING = {
	1: "1 - Presumed TB",
	2: "2 - No Signs",
	3: "3 - On TB Treatment",
	4: "4 - Not Done",
}
PENDING_LAB = ["Requested", "Sample Collected"]
# Family planning: (label, method group), most effective first. The first one provided is the client's method.
FP_METHODS = [
	("Implant (1-rod, Implanon NXT)", "Implant"), ("Implant (2-rod, Jadelle / Levoplant)", "Implant"),
	("IUCD (Copper T)", "IUCD"), ("IUCD (Hormonal, LNG-IUS)", "IUCD"),
	("BTL (tubal ligation)", "Permanent (BTL/Vasectomy)"), ("Vasectomy", "Permanent (BTL/Vasectomy)"),
	("DMPA-IM (Depo-Provera)", "Injectable"), ("DMPA-SC (Sayana Press)", "Injectable"),
	("COC (Microgynon)", "Pills"), ("POP (Microlut)", "Pills"), ("ECP (emergency pills)", "Pills"),
	("Male condoms", "Condoms"), ("Female condoms", "Condoms"),
	("SDM / CycleBeads", "Natural Method"), ("LAM", "Natural Method"),
]
REFER_HIGH_RISK = "Referred to High-Risk Clinic / Consultant"
EXTERNAL_ANC_REFERRALS = ("Referred to Tertiary / Higher Facility", "Referred to CCC (Comprehensive Care Centre)")
MUAC_CATEGORIES = {
	1: "1 = Green (Normal >= 12.5cm)",
	2: "2 = Yellow (MAM 11.5cm - 12.4cm)",
	3: "3 = Red (SAM < 11.5cm)",
}


class ClinicAttendance(Document):
	def onload(self):
		for row in self.lab_requests:
			if row.lab_test:
				row.lab_status, row.result = frappe.db.get_value(
					"Clinic Lab Test", row.lab_test, ["status", "interpretation"]
				)

	def validate(self):
		self.validate_visit()
		if self.service_type not in UNIT_SERVICES.get(self.clinic_unit, ()):
			frappe.throw(_("{0} is not offered by the {1}").format(self.service_type, self.clinic_unit))
		self.set_from_triage()
		self.set_derived_values()
		if self.service_type == "CWC Attendance":
			self.set_cwc_values()
		elif self.service_type == "ANC Attendance":
			self.set_anc_values()
		elif self.service_type == "Family Planning":
			self.set_fp_values()
		elif self.service_type == "Postnatal Attendance":
			self.set_pnc_values()
		elif self.service_type == "HTS Attendance":
			self.set_hts_values()
		if self.follow_up_required and not self.appointment and getdate(self.follow_up_date) < getdate(nowdate()):
			frappe.throw(_("Follow-up date cannot be in the past"))
		stock.check_prescriptions(self)
		for row in self.prescriptions:
			if (row.quantity or 0) <= 0:
				frappe.throw(_("Row {0}: quantity for {1} must be greater than zero").format(row.idx, row.drug))

	def after_insert(self):
		frappe.db.set_value("Clinic Visit", self.visit, "attendance", self.name)
		set_visit_status(self.visit, "In Clinic")

	def on_update(self):
		if self.service_type == "ANC Attendance":
			self.sync_anc_record()
		elif self.service_type == "Family Planning":
			self.sync_fp_record()
		elif self.service_type == "Postnatal Attendance":
			self.sync_pnc_record()

	def validate_visit(self):
		if not self.is_new():
			return
		status = frappe.db.get_value("Clinic Visit", self.visit, "status")
		if status in CLOSED_STATUSES:
			frappe.throw(_("Visit {0} is {1}").format(self.visit, status))
		existing = frappe.db.exists("Clinic Attendance", {"visit": self.visit})
		if existing:
			frappe.throw(_("Attendance {0} already exists for this visit").format(existing))

	def set_from_triage(self):
		self.triage = frappe.db.get_value("Clinic Visit", self.visit, "triage")
		if not self.triage:
			self.vitals_summary = None
			return
		t = frappe.db.get_value(
			"Clinic Triage",
			self.triage,
			["bp_systolic", "bp_diastolic", "pulse_rate", "temperature", "spo2", "weight_kg", "height_cm", "bmi", "alerts",
			 "blood_glucose", "respiratory_rate"],
			as_dict=True,
		)
		if self.service_type in ("ANC Attendance", "Family Planning"):
			# what triage already measured is not typed again; the clinician can still overwrite it
			for field, source in (
				("weight_kg", t.weight_kg), ("height_cm", t.height_cm), ("bp_systolic", t.bp_systolic),
				("bp_diastolic", t.bp_diastolic), ("blood_sugar", t.blood_glucose),
			):
				if source and not self.get(field):
					self.set(field, source)
		if self.service_type == "Postnatal Attendance":
			for field, source in (
				("bp_systolic", t.bp_systolic), ("bp_diastolic", t.bp_diastolic), ("pulse_bpm", t.pulse_rate),
				("temp_c", t.temperature), ("resp_rate", t.respiratory_rate),
			):
				if source and not self.get(field):
					self.set(field, source)
		parts = []
		if t.bp_systolic:
			parts.append(f"BP {t.bp_systolic}/{t.bp_diastolic} mmHg")
		for label, value, unit in (
			("Pulse", t.pulse_rate, "bpm"), ("Temp", t.temperature, "°C"), ("SpO₂", t.spo2, "%"),
			("Weight", t.weight_kg, "kg"), ("Height", t.height_cm, "cm"), ("BMI", t.bmi, ""),
		):
			if value:
				parts.append(f"{label} {value} {unit}".strip())
		self.vitals_summary = " | ".join(parts)
		if t.alerts:
			self.vitals_summary += "\n" + _("Alerts: ") + t.alerts.replace("\n", "; ")

	def set_derived_values(self):
		self.tb_screening_code = cint((self.tb_screening or "0")[:1])
		self.edd = add_days(self.lmp, 280) if self.lmp else None
		self.gestation_weeks = max(date_diff(nowdate(), self.lmp) // 7, 0) if self.lmp else None
		self.days_postpartum = max(date_diff(nowdate(), self.delivery_date), 0) if self.delivery_date else None
		self.weeks_on_treatment = (
			max(date_diff(nowdate(), self.treatment_start_date) // 7, 0) if self.treatment_start_date else None
		)
		if not self.refer_out and self.service_type != "ANC Attendance":  # ANC derives it from its referral choice
			self.referral_facility = self.referral_reason = None

	# ------------------------------------------------------------ CWC register
	def set_cwc_values(self):
		"""Child Welfare Clinic register rules: age, categories, screening and the new/revisit flag."""
		dob = frappe.db.get_value("Clinic Patient", self.patient, "date_of_birth")
		if not dob:
			frappe.throw(_("A date of birth is needed for CWC. Add it on the patient record."))
		months = age_in_months(dob, self.attendance_date)
		if months > 59:
			frappe.throw(
				_("CWC is for children under 5 years (0-59 months). This child is {0}.").format(age_text(dob, self.attendance_date))
			)
		self.cwc_age_months = months
		self.child_record = frappe.db.get_value("Clinic Child Record", {"patient": self.patient}, "name")

		earlier = frappe.db.count(
			"Clinic Attendance",
			{"patient": self.patient, "service_type": "CWC Attendance", "name": ["!=", self.name or ""]},
		)
		self.cwc_visit_kind = "Revisit" if earlier else "New Visit"

		for value, code in (
			("weight_category", "weight_category_code"), ("stunting_status", "stunting_code"),
			("muac_category", "muac_code"), ("vit_a_supplementation", "vit_a_code"),
			("developmental_status", "developmental_code"),
		):
			setattr(self, code, cint((self.get(value) or "0")[:1]))

		for field, low, high, label in (
			("weight_kg", 0.3, 30, _("Weight")), ("height_cm", 30, 130, _("Height/length")), ("muac_cm", 5, 25, _("MUAC")),
		):
			value = self.get(field)
			if value and not low <= value <= high:
				frappe.throw(_("{0} of {1} looks wrong. Expected between {2} and {3}.").format(label, value, low, high))

		# MUAC is optional at any age; the colour follows the measurement
		if self.muac_cm:
			self.muac_code = 1 if self.muac_cm >= 12.5 else 2 if self.muac_cm >= 11.5 else 3
			self.muac_category = MUAC_CATEGORIES[self.muac_code]
		else:
			self.muac_category = None
			self.muac_code = 0
		if months >= 6:
			self.cwc_exclusive_bf = None  # exclusive breastfeeding is recorded for under-6-months only
		if months < 12:
			self.dewormed = 0  # deworming starts at 12 months
		if not self.disability_identified:
			self.disability_details = None
		if self.developmental_code != 2:
			self.milestone_delay_details = None

		signs = [s.strip() for s in (self.danger_signs or "").split(",") if s.strip()]
		if "None" in signs and len(signs) > 1:
			signs = [s for s in signs if s != "None"]  # a real sign overrides "None"
		self.danger_signs = ", ".join(signs) or None
		self.has_danger_signs = 1 if [s for s in signs if s != "None"] else 0

		child = frappe.db.get_value("Clinic Child Record", self.child_record, ["is_defaulter", "overdue_count"], as_dict=True) if self.child_record else None
		self.immunization_up_to_date = 1 if child and not child.is_defaulter and not child.overdue_count else 0

	# ------------------------------------------------------------ ANC register
	def set_anc_values(self):
		"""Antenatal register rules: the register entry, visit number, categories and the referral route."""
		self.anc_record = self.anc_record or frappe.db.get_value(
			"Clinic ANC Record", {"patient": self.patient, "status": "Active"}, "name"
		)
		earlier = frappe.get_all(
			"Clinic Attendance",
			filters={
				"patient": self.patient, "service_type": "ANC Attendance", "status": "Completed",
				"name": ["!=", self.name or ""], "anc_record": self.anc_record or "",
			},
			pluck="anc_visit_number",
		) if self.anc_record else []
		self.anc_visit_kind = "Revisit" if earlier else "New Client"
		# a client who attended elsewhere first can start the count higher; after that it counts itself
		self.anc_visit_number = (max([cint(n) for n in earlier]) + 1) if earlier else (cint(self.anc_visit_number) or 1)

		for field, low, high, label in (
			("weight_kg", 25, 200, _("Weight")), ("height_cm", 100, 220, _("Height")), ("muac_cm", 10, 45, _("MUAC")),
			("bp_systolic", 60, 260, _("Systolic BP")), ("bp_diastolic", 30, 160, _("Diastolic BP")),
			("fetal_heart_rate", 60, 220, _("Fetal heart rate")), ("hb_level", 2, 20, _("Haemoglobin")),
			("fundal_height_cm", 5, 50, _("Fundal height")), ("blood_sugar", 0.5, 40, _("Blood sugar")),
		):
			value = self.get(field)
			if value and not low <= value <= high:
				frappe.throw(_("{0} of {1} looks wrong. Expected between {2} and {3}.").format(label, value, low, high))
		if self.bp_systolic and self.bp_diastolic and self.bp_diastolic >= self.bp_systolic:
			frappe.throw(_("Diastolic BP must be lower than the systolic BP"))
		if self.lmp and getdate(self.lmp) > getdate(nowdate()):
			frappe.throw(_("LMP cannot be in the future"))
		if self.gestation_weeks and self.gestation_weeks > 44:
			frappe.throw(_("The LMP gives {0} weeks of gestation. Check the date: this client may belong in the postnatal clinic.").format(self.gestation_weeks))
		if cint(self.abortions) > cint(self.gravida) and self.gravida:
			frappe.throw(_("Abortions cannot be more than the number of pregnancies (gravida)"))

		if self.muac_cm:
			self.anc_muac_category = (
				"SAM (<19.0 cm)" if self.muac_cm < 19 else "Underweight/MAM (<23.0 cm)" if self.muac_cm < 23 else "Normal (>=23.0 cm)"
			)
		else:
			self.anc_muac_category = None

		# the tick boxes the older reports read follow the detailed answers
		self.iron_folate_given = 1 if cint(self.ifa_count) > 0 else 0
		self.ipt_given = 1 if self.iptp_doses and not self.iptp_doses.startswith("None") else 0
		self.tt_given = 1 if self.tt_dose and self.tt_dose[:2] == "TT" else 0

		if self.syphilis_client != "Reactive":
			self.syphilis_treatment = 0
		# final HIV status follows the earlier answers unless the clinician has set it
		if not self.hiv_final_status:
			if "Positive" in (self.hiv_status_prior, (self.hiv_test_anc or "").replace("Tested ", "")):
				self.hiv_final_status = "Positive"
			elif "Negative" in (self.hiv_status_prior, (self.hiv_test_anc or "").replace("Tested ", "")):
				self.hiv_final_status = "Negative"
		if self.hiv_final_status == "Negative" and not self.art_status:
			self.art_status = "N/A (Negative)"

		signs = [s.strip() for s in (self.complications or "").split(",") if s.strip()]
		if "None" in signs and len(signs) > 1:
			signs = [s for s in signs if s != "None"]  # a real complication overrides "None"
		self.complications = ", ".join(signs) or None

		# Referral Out: a facility outside needs its name; the others are handled inside the clinic
		self.refer_out = 1 if self.anc_referral in EXTERNAL_ANC_REFERRALS else 0
		if self.refer_out and not self.referral_reason:
			self.referral_reason = self.anc_referral
		if not self.refer_out:
			self.referral_facility = self.referral_reason = None

	def sync_anc_record(self):
		"""The latest obstetric details carry over to the client's next visit."""
		if not self.anc_record:
			return
		# zero is a real answer for parity and abortions, so they always carry over
		values = {"parity": cint(self.parity), "abortions": cint(self.abortions)}
		for field in ("gravida", "height_cm", "lmp"):
			if self.get(field):
				values[field] = self.get(field)
		values["edd"] = self.edd
		if self.status == "Completed":
			values["last_visit_date"] = getdate(self.attendance_date)
			values["visits_count"] = frappe.db.count(
				"Clinic Attendance", {"anc_record": self.anc_record, "status": "Completed", "name": ["!=", self.name]}
			) + 1
		frappe.db.set_value("Clinic ANC Record", self.anc_record, values, update_modified=False)
		if self.blood_group and not frappe.db.get_value("Clinic Patient", self.patient, "blood_group"):
			frappe.db.set_value("Clinic Patient", self.patient, "blood_group", self.blood_group, update_modified=False)

	def validate_anc_complete(self):
		if not self.anc_record:
			frappe.throw(_("Open the ANC register entry for this client first (enter the ANC number)."))
		missing = [
			label
			for field, label in (
				("lmp", _("LMP")), ("gravida", _("Gravida")), ("weight_kg", _("Weight")),
				("bp_systolic", _("Systolic BP")), ("bp_diastolic", _("Diastolic BP")),
				("complications", _("Maternal complications (choose None if there are none)")),
				("anc_referral", _("Referral out (choose None if not referred)")),
			)
			if self.get(field) in (None, "", 0)
		]
		if missing:
			frappe.throw(_("Complete the ANC register before closing: {0}").format(", ".join(missing)))
		if self.refer_out and not self.referral_facility:
			frappe.throw(_("Name the facility the client is referred to"))
		if self.anc_referral == "Referred to Laboratory" and not self.lab_requests:
			frappe.throw(_("The client is referred to the laboratory. Request the tests on the Investigations tab and press Send to Lab, or change the referral."))
		if self.anc_referral == REFER_HIGH_RISK:
			frappe.throw(_("The client is referred to the high-risk clinic / consultant. Use Refer to Doctor, or change the referral."))

	# ------------------------------------------------------------ family planning register
	def fp_provided(self):
		"""(everything provided or booked this visit, methods removed) from the Section 3 answers."""
		given = {
			"Implant (1-rod, Implanon NXT)": self.implant1_action in ("Inserted", "Replaced"),
			"Implant (2-rod, Jadelle / Levoplant)": self.implant2_action in ("Inserted", "Replaced"),
			"IUCD (Copper T)": self.iucd_copper_action in ("Inserted", "Replaced"),
			"IUCD (Hormonal, LNG-IUS)": self.iucd_hormonal_action in ("Inserted", "Replaced"),
			"BTL (tubal ligation)": bool(self.btl_status), "Vasectomy": bool(self.vasectomy_status),
			"DMPA-IM (Depo-Provera)": bool(self.dmpa_im_given), "DMPA-SC (Sayana Press)": bool(self.dmpa_sc_given),
			"COC (Microgynon)": cint(self.coc_cycles) > 0, "POP (Microlut)": cint(self.pop_cycles) > 0,
			"ECP (emergency pills)": cint(self.ecp_doses) > 0,
			"Male condoms": cint(self.male_condoms) > 0, "Female condoms": cint(self.female_condoms) > 0,
			"SDM / CycleBeads": bool(self.sdm_given), "LAM": bool(self.lam_educated),
		}
		removed = any(a == "Removed" for a in (self.implant1_action, self.implant2_action, self.iucd_copper_action, self.iucd_hormonal_action))
		return [label for label, _group in FP_METHODS if given[label]], removed

	def set_fp_values(self):
		"""Family planning register rules: the register entry, the method summary and change-of-method details."""
		self.fp_record = self.fp_record or frappe.db.get_value("Clinic FP Record", {"patient": self.patient}, "name")
		provided, _removed = self.fp_provided()
		groups = dict(FP_METHODS)
		self.fp_methods_provided = ", ".join(provided) or None
		self.fp_method = groups[provided[0]] if provided else "Counselling only"

		for field, low, high, label in (
			("coc_cycles", 0, 24, _("COC cycles")), ("pop_cycles", 0, 24, _("POP cycles")), ("ecp_doses", 0, 6, _("ECP doses")),
			("dmpa_sc_doses", 0, 6, _("DMPA-SC doses")), ("male_condoms", 0, 500, _("Male condoms")),
			("female_condoms", 0, 500, _("Female condoms")), ("bp_systolic", 60, 260, _("Systolic BP")),
			("bp_diastolic", 30, 160, _("Diastolic BP")), ("weight_kg", 25, 250, _("Weight")),
		):
			value = cint(self.get(field)) if isinstance(low, int) and field not in ("weight_kg",) else self.get(field)
			if value and not low <= value <= high:
				frappe.throw(_("{0} of {1} looks wrong. Expected between {2} and {3}.").format(label, value, low, high))
		if self.bp_systolic and self.bp_diastolic and self.bp_diastolic >= self.bp_systolic:
			frappe.throw(_("Diastolic BP must be lower than the systolic BP"))
		if self.dmpa_sc_given != "Issued for Self-Injection":
			self.dmpa_sc_doses = 0

		switching = (self.fp_client_type or "").startswith("3")
		if switching:
			if not self.fp_method_to and provided:
				self.fp_method_to = provided[0]
			if self.fp_switch_reason != "Side Effects":
				self.fp_side_effects = None
		else:
			self.fp_method_from = self.fp_method_to = self.fp_switch_reason = self.fp_switch_notes = self.fp_side_effects = None
		signs = [s.strip() for s in (self.fp_side_effects or "").split(",") if s.strip()]
		self.fp_side_effects = ", ".join(signs) or None

	def sync_fp_record(self):
		"""The client's current method carries over, so a later change of method starts from it."""
		if not self.fp_record:
			return
		values = {}
		provided, removed = self.fp_provided()
		ongoing = [m for m in provided if not m.startswith("ECP")]
		# a referral for BTL/vasectomy is not yet a method in use
		if self.btl_status == "Referred Out" and "BTL (tubal ligation)" in ongoing:
			ongoing.remove("BTL (tubal ligation)")
		if self.vasectomy_status == "Referred Out" and "Vasectomy" in ongoing:
			ongoing.remove("Vasectomy")
		current = frappe.db.get_value("Clinic FP Record", self.fp_record, "current_method")
		if ongoing:
			values["current_method"] = ongoing[0]
			if current != ongoing[0]:
				values["method_since"] = getdate(self.attendance_date)
		elif removed and not provided:
			values["current_method"] = None
			values["method_since"] = None
		if self.status == "Completed":
			values["last_visit_date"] = getdate(self.attendance_date)
			values["visits_count"] = frappe.db.count(
				"Clinic Attendance", {"fp_record": self.fp_record, "status": "Completed", "name": ["!=", self.name]}
			) + 1
		if values:
			frappe.db.set_value("Clinic FP Record", self.fp_record, values, update_modified=False)

	def validate_fp_complete(self):
		if not self.fp_record:
			frappe.throw(_("Open the FP register entry for this client first (enter the FP number)."))
		if not self.fp_client_type:
			frappe.throw(_("Choose the client type before closing"))
		if (self.fp_client_type or "").startswith("3"):
			missing = [
				label for field, label in (
					("fp_method_from", _("method changed from")), ("fp_method_to", _("method changed to")),
					("fp_switch_reason", _("reason for the change")),
				) if not self.get(field)
			]
			if self.fp_switch_reason == "Side Effects" and not self.fp_side_effects:
				missing.append(_("side effects reported"))
			if missing:
				frappe.throw(_("Complete the change of method: {0}").format(", ".join(missing)))

	# ------------------------------------------------------------ postnatal register
	def set_pnc_values(self):
		"""Postnatal register rules: the register entry, visit count, plausibility and HIV defaults."""
		self.pnc_record = self.pnc_record or frappe.db.get_value(
			"Clinic PNC Record", {"patient": self.patient, "status": "Active"}, "name"
		)
		earlier = frappe.get_all(
			"Clinic Attendance",
			filters={"service_type": "Postnatal Attendance", "status": "Completed", "pnc_record": self.pnc_record,
				"name": ["!=", self.name or ""]},
			pluck="postnatal_visit_no",
		) if self.pnc_record else []
		self.postnatal_visit_no = (max([cint(n) for n in earlier]) + 1) if earlier else 1

		if self.delivery_date and getdate(self.delivery_date) > getdate(nowdate()):
			frappe.throw(_("The date of delivery cannot be in the future"))
		if self.delivery_date and date_diff(nowdate(), self.delivery_date) > 365:
			frappe.throw(_("The delivery was over a year ago. Check the date of delivery."))
		for field, low, high, label in (
			("bp_systolic", 60, 260, _("Systolic BP")), ("bp_diastolic", 30, 160, _("Diastolic BP")),
			("pulse_bpm", 30, 220, _("Pulse rate")), ("temp_c", 30, 43, _("Temperature")),
			("resp_rate", 5, 60, _("Respiratory rate")), ("infant_temp_c", 30, 43, _("Infant temperature")),
			("infant_weight_kg", 0.5, 8, _("Infant weight")), ("ifa_count", 0, 365, _("IFA tablets")),
		):
			value = self.get(field)
			if value and not low <= value <= high:
				frappe.throw(_("{0} of {1} looks wrong. Expected between {2} and {3}.").format(label, value, low, high))
		if self.bp_systolic and self.bp_diastolic and self.bp_diastolic >= self.bp_systolic:
			frappe.throw(_("Diastolic BP must be lower than the systolic BP"))

		# after a stillbirth there is no baby to examine or protect
		if self.delivery_outcome and not self.delivery_outcome.startswith("Live"):
			for field in ("baby_pnc_timing", "infant_temp_c", "infant_weight_kg", "cord_condition", "infant_feeding",
				"infant_jaundice", "infant_danger_signs", "infant_arv", "eid_pcr"):
				self.set(field, None)
			self.infant_ctx = 0

		positive = "Positive" in (self.mat_hiv_initial, (self.mat_hiv_retest or "").replace("Tested ", ""))
		negative = not positive and "Negative" in (self.mat_hiv_initial, (self.mat_hiv_retest or "").replace("Tested ", ""))
		if negative:
			self.maternal_haart = self.maternal_haart or "4 = N/A (Negative)"
			if self.delivery_outcome in (None, "", "Live Birth"):
				self.infant_arv = self.infant_arv or "4 = N/A (HIV Negative Mother)"
		if self.pnc_fp_method and self.pnc_fp_method[:1] != "9" and not self.pnc_fp_date:
			self.pnc_fp_date = nowdate()
		if not self.pnc_fp_method or self.pnc_fp_method[:1] == "9":
			self.pnc_fp_date = None
		if self.pnc_fp_date and getdate(self.pnc_fp_date) > getdate(nowdate()):
			frappe.throw(_("The FP dispensing date cannot be in the future"))

		for field in ("infant_danger_signs", "maternal_complications"):
			values = [s.strip() for s in (self.get(field) or "").split(",") if s.strip()]
			if "None" in values and len(values) > 1:
				values = [s for s in values if s != "None"]  # a real finding overrides "None"
			self.set(field, ", ".join(values) or None)
		self.exclusive_breastfeeding = 1 if (self.infant_feeding or "").startswith("Exclusive") else 0
		self.mother_condition = self.maternal_condition

	def sync_pnc_record(self):
		"""Delivery details are entered once; the next visit starts from them."""
		if not self.pnc_record:
			return
		values = {"parity": cint(self.parity)}
		for field in ("gravida", "delivery_date", "delivery_time", "delivery_place", "delivery_mode", "delivery_outcome"):
			if self.get(field):
				values[field] = self.get(field)
		if self.status == "Completed":
			values["last_visit_date"] = getdate(self.attendance_date)
			values["visits_count"] = frappe.db.count(
				"Clinic Attendance", {"pnc_record": self.pnc_record, "status": "Completed", "name": ["!=", self.name]}
			) + 1
		frappe.db.set_value("Clinic PNC Record", self.pnc_record, values, update_modified=False)

	def validate_pnc_complete(self):
		if not self.pnc_record:
			frappe.throw(_("Open the PNC register entry for this mother first (enter the PNC number)."))
		live = (self.delivery_outcome or "").startswith("Live")
		missing = [
			label for field, label in (
				("delivery_date", _("Date of delivery")), ("delivery_place", _("Place of delivery")),
				("delivery_mode", _("Mode of delivery")), ("delivery_outcome", _("Delivery outcome")),
				("mother_pnc_timing", _("Mother PNC visit timing")), ("maternal_complications", _("Maternal complications (choose None if there are none)")),
			) if not self.get(field)
		]
		if live:
			missing += [label for field, label in (
				("baby_pnc_timing", _("Baby PNC visit timing")), ("infant_danger_signs", _("Infant danger signs (choose None if there are none)")),
			) if not self.get(field)]
		if missing:
			frappe.throw(_("Complete the postnatal register before closing: {0}").format(", ".join(missing)))
		if "Positive" in (self.mat_hiv_initial, (self.mat_hiv_retest or "").replace("Tested ", "")):
			if not self.maternal_haart:
				frappe.throw(_("The mother is HIV positive. Record her HAART status."))
			if live and not self.infant_arv:
				frappe.throw(_("The mother is HIV positive. Record the infant ARV prophylaxis."))

	# ------------------------------------------------------------ HIV testing clinic
	def set_hts_values(self):
		"""The outcome follows the two tests; prevention services are offered to clients who test negative."""
		t1, t2 = self.hts_test1_result, self.hts_test2_result
		if t1 and t2:
			self.hts_final_result = "Positive" if t1 == t2 == "Reactive" else "Negative" if t1 == t2 else "Inconclusive"
		else:
			self.hts_final_result = None
		services = [s.strip() for s in (self.prevention_services or "").split(",") if s.strip()]
		if "None" in services and len(services) > 1:
			services = [s for s in services if s != "None"]  # a real service overrides "None"
		self.prevention_services = ", ".join(services) if services and self.hts_final_result == "Negative" else None

	def validate_hts_complete(self):
		missing = [
			label for field, label in (
				("hts_test_type", _("Test type (initial, repeat or retesting)")),
				("hts_test1_result", _("Test 1 (Determine) result")), ("hts_test2_result", _("Test 2 (confirmatory) result")),
				("couple_status", _("Couple testing and discordancy status")),
			) if not self.get(field)
		]
		if self.hts_final_result == "Negative" and not self.prevention_services:
			missing.append(_("Prevention services offered (choose None if none)"))
		if missing:
			frappe.throw(_("Complete the HTS record before closing: {0}").format(", ".join(missing)))

	def validate_cwc_complete(self):
		if not self.child_record:
			frappe.throw(_("Open the CWC register entry for this child first (CWC Attendance tab)."))
		missing = [
			label
			for field, label in (
				("weight_kg", _("Weight")), ("weight_category", _("Weight category")), ("height_cm", _("Height / length")),
				("stunting_status", _("Stunting category")), ("developmental_status", _("Developmental status")),
				("danger_signs", _("Danger signs screening")),
			)
			if not self.get(field)
		]
		if self.developmental_code == 2 and not self.milestone_delay_details:
			missing.append(_("Delay details"))
		if missing:
			frappe.throw(_("Complete the CWC register before closing: {0}").format(", ".join(missing)))

	# ------------------------------------------------------------ actions
	@frappe.whitelist()
	def set_tb_screening(self, code):
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
		create_lab_tests(self, "attendance")
		self.status = "Awaiting Lab"
		self.save()
		set_visit_status(self.visit, "Waiting Lab")

	@frappe.whitelist()
	def send_to_pharmacy(self):
		self.check_permission("write")
		if not self.prescriptions:
			frappe.throw(_("Add at least one prescription item first"))
		self.validate_ready_to_close()
		create_dispensing(self, "attendance")
		self.finalise("Waiting Pharmacy")

	@frappe.whitelist()
	def refer_to_doctor(self):
		"""Hand the patient over to the doctor's queue (triage vitals are already on the visit)."""
		self.check_permission("write")
		self.validate_ready_to_close(require_diagnosis=False, complete_register=False)
		self.referred_to_doctor = 1
		self.status = "Completed"
		self.save()
		frappe.db.set_value("Clinic Visit", self.visit, "service_point", "Consultation")
		set_visit_status(self.visit, "Waiting Consultation")

	@frappe.whitelist()
	def complete_attendance(self):
		self.check_permission("write")
		if self.prescriptions and not self.dispensing:
			frappe.throw(_("There are prescriptions on this attendance. Use Send to Pharmacy."))
		self.validate_ready_to_close()
		if self.return_to_doctor():
			return
		self.finalise("Completed")

	def return_to_doctor(self):
		"""A client the doctor sent for HIV testing goes back to the doctor's queue to finish the encounter."""
		if self.service_type != "HTS Attendance":
			return False
		consultation = frappe.db.get_value("Clinic Visit", self.visit, "consultation")
		if not consultation or frappe.db.get_value("Clinic Consultation", consultation, "status") == "Completed":
			return False
		self.status = "Completed"
		self.save()
		frappe.db.set_value("Clinic Consultation", consultation, "hts_status", "Done")
		frappe.db.set_value("Clinic Visit", self.visit, "service_point", "Consultation")
		set_visit_status(self.visit, "Waiting Consultation")
		return True

	def validate_ready_to_close(self, require_diagnosis=True, complete_register=True):
		if self.service_type == "CWC Attendance" and complete_register:
			self.validate_cwc_complete()
		if self.service_type == "ANC Attendance" and complete_register:
			self.validate_anc_complete()
		if self.service_type == "Family Planning" and complete_register:
			self.validate_fp_complete()
		if self.service_type == "Postnatal Attendance" and complete_register:
			self.validate_pnc_complete()
		if self.service_type == "HTS Attendance":
			self.validate_hts_complete()  # the HIV testing clinic does no TB screening
		else:
			if not self.tb_screening:
				frappe.throw(_("Record the TB screening (1-4) before closing this attendance"))
			check_tb_test_sent(self)
		pending = frappe.db.count("Clinic Lab Test", {"visit": self.visit, "status": ["in", PENDING_LAB]})
		if pending:
			frappe.throw(_("{0} lab test(s) are still awaiting results").format(pending))

	def finalise(self, visit_status):
		create_follow_up(self)
		self.status = "Completed"
		self.save()
		set_visit_status(self.visit, visit_status)
