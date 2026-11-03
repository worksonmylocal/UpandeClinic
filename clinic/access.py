"""Who may hand out clinic roles, and who may see the clinic at all.

* Clinic roles can only be assigned or removed by the clinic access administrator: the user named in
  `clinic_access_admin` in the site's site_config.json (System Managers cannot edit that file) or, when that is not
  set, the user named in Clinic Settings > Clinic Access Administrator. Until one is set, only Administrator can do it.
* Clinic data is only readable by holders of a clinic role. System Manager has no access to the clinic doctypes,
  and nobody else can add permissions to them.
"""

import frappe
from frappe import _

from clinic.setup import ROLES

CLINIC_ROLES = set(ROLES)


def configured_in_site_config():
	return bool(frappe.conf.get("clinic_access_admin"))


def access_admin():
	"""The site config wins (System Managers cannot edit it); otherwise the person named in Clinic Settings."""
	return frappe.conf.get("clinic_access_admin") or frappe.db.get_single_value("Clinic Settings", "access_administrator") or None


def can_manage_access(user=None):
	user = user or frappe.session.user
	admin = access_admin()
	return user == admin if admin else user == "Administrator"


def _skip():
	return frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch or frappe.flags.in_test


def _deny(what):
	"""Say why: an unset site config is the usual cause, so name the key to set."""
	admin = access_admin()
	if not admin:
		reason = _(
			"No clinic access administrator is set on this site. A Clinic Manager can claim it in Clinic Settings (Clinic Access Administrator), or add clinic_access_admin to the site config."
		)
	else:
		reason = _("You are signed in as {0}, which is not the clinic access administrator. The administrator can be changed in Clinic Settings by the current administrator.").format(
			frappe.session.user
		)
	frappe.throw(_("Only the clinic access administrator can {0}. {1}").format(what, reason), frappe.PermissionError)


def guard_user_roles(doc, method=None):
	"""User: clinic roles cannot be added or removed (directly or through a role profile) by anyone else."""
	if _skip() or can_manage_access():
		return
	after = {r.role for r in doc.get("roles")} & CLINIC_ROLES
	before = set()
	if not doc.is_new():
		before = set(
			frappe.get_all("Has Role", filters={"parenttype": "User", "parent": doc.name}, pluck="role")
		) & CLINIC_ROLES
	if after != before:
		_deny(_("assign or remove clinic roles"))


def guard_role_profile(doc, method=None):
	"""Role Profile: the same rule, so a profile cannot be used to slip clinic roles in."""
	if _skip() or can_manage_access():
		return
	after = {r.role for r in doc.get("roles")} & CLINIC_ROLES
	before = set()
	if not doc.is_new():
		before = set(
			frappe.get_all("Has Role", filters={"parenttype": "Role Profile", "parent": doc.name}, pluck="role")
		) & CLINIC_ROLES
	if after != before:
		_deny(_("add clinic roles to a role profile"))


def guard_permissions(doc, method=None):
	"""Custom DocPerm: nobody else can open up the clinic doctypes through the Role Permissions Manager."""
	if _skip() or can_manage_access():
		return
	if frappe.db.get_value("DocType", doc.parent, "module") == "Clinic":
		_deny(_("change permissions on clinic documents"))


def has_clinic_role(user=None):
	"""A role that opens the clinic app on the desk. First aiders only use their phone page, not the desk."""
	return bool(set(frappe.get_roles(user)) & (CLINIC_ROLES - {"Clinic First Aider"}))
