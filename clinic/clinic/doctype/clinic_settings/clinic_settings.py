import frappe
from frappe import _
from frappe.model.document import Document


class ClinicSettings(Document):
	def validate(self):
		self.validate_access_administrator()

	def validate_access_administrator(self):
		"""Who may change the access administrator (see clinic/access.py)."""
		from clinic import access

		before = self.get_doc_before_save()
		old = (before.get("access_administrator") if before else None) or None
		new = self.get("access_administrator") or None
		if old == new:
			return
		if access.configured_in_site_config():
			frappe.throw(
				_("The clinic access administrator is set in the site config (clinic_access_admin), so it cannot be changed here."),
				frappe.PermissionError,
			)
		if access.can_manage_access() or frappe.session.user == "Administrator":
			return  # the current administrator may hand over or clear it; Administrator can always recover a lost one
		if not old and new == frappe.session.user and "Clinic Manager" in frappe.get_roles():
			return  # nobody is set yet: a Clinic Manager may claim it for themselves
		if not old:
			frappe.throw(
				_("Nobody is set yet. A Clinic Manager can claim it, but only for themselves: choose your own user."),
				frappe.PermissionError,
			)
		frappe.throw(
			_("Only the current clinic access administrator ({0}) can change this.").format(old), frappe.PermissionError
		)

	def on_update(self):
		before = self.get_doc_before_save()
		if (before.get("biometric_device_id") if before else None) != self.get("biometric_device_id"):
			from clinic import attendance

			attendance.relabel()
