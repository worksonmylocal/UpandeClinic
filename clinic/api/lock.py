"""Screen lock: after a spell of inactivity the desk asks for the user's 4-digit PIN.

This hides patient details from a passer-by at an unattended computer. It is not a second login:
the PIN is kept on the user's Clinic Staff Profile and only ever checked here.
"""

import hmac

import frappe
from frappe import _
from frappe.utils.password import get_decrypted_password

MAX_TRIES = 5
LOCKOUT_SECONDS = 300


def _require_user():
	if frappe.session.user == "Guest":
		raise frappe.AuthenticationError


def _pin(user):
	name = frappe.db.get_value("Clinic Staff Profile", {"user": user}, "name")
	if not name:
		return None
	return get_decrypted_password("Clinic Staff Profile", name, "lock_pin", raise_exception=False) or None


def _minutes(user):
	"""How long the screen may sit idle: the user's own setting, else the clinic's, else 15."""
	own = frappe.db.get_value("Clinic Staff Profile", {"user": user}, "lock_after_minutes")
	default = frappe.db.get_single_value("Clinic Settings", "idle_lock_minutes")
	return min(max(int(own or default or 15), 1), 240)


def _key(kind, user):
	return f"clinic_{kind}:{user}"


@frappe.whitelist()
def status():
	"""Whether this user has a PIN, and whether their screen is currently locked."""
	_require_user()
	has_pin = bool(_pin(frappe.session.user))
	return {
		"has_pin": has_pin,
		"locked": bool(has_pin and frappe.cache.get_value(_key("lock", frappe.session.user))),
		"minutes": _minutes(frappe.session.user),
	}


@frappe.whitelist()
def lock():
	"""Remember that the screen is locked, so a refresh or another tab cannot skip the PIN."""
	_require_user()
	if not _pin(frappe.session.user):
		return {"locked": False}
	frappe.cache.set_value(_key("lock", frappe.session.user), 1)
	return {"locked": True}


@frappe.whitelist()
def unlock(pin):
	"""Check the PIN. Five wrong tries in a row pause further tries for five minutes."""
	_require_user()
	user = frappe.session.user
	tries = frappe.cache.get_value(_key("tries", user)) or 0
	if tries >= MAX_TRIES:
		frappe.throw(_("Too many wrong PINs. Wait five minutes, or sign out and log in with your password."))
	expected = _pin(user)
	if expected and hmac.compare_digest(str(pin or "").strip(), str(expected)):
		frappe.cache.delete_value(_key("tries", user))
		frappe.cache.delete_value(_key("lock", user))
		return {"locked": False}
	frappe.cache.set_value(_key("tries", user), tries + 1, expires_in_sec=LOCKOUT_SECONDS)
	left = MAX_TRIES - tries - 1
	frappe.throw(_("Wrong PIN.") + (" " + _("{0} tries left.").format(left) if left > 0 else " " + _("Locked for five minutes.")))


def verify_pin(user, pin, scope="waiver"):
	"""Check another person's screen-lock PIN (a manager signing something off). Throttled per requester so it cannot be guessed."""
	requester = frappe.session.user
	key = _key("verify_tries_" + scope, requester)
	tries = frappe.cache.get_value(key) or 0
	if tries >= MAX_TRIES:
		frappe.throw(_("Too many wrong PINs. Wait five minutes and try again."))
	expected = _pin(user) if user else None
	if not expected:
		frappe.throw(_("The Clinic Manager has no screen-lock PIN set up, so this cannot be authorised."))
	if not hmac.compare_digest(str(pin or "").strip(), str(expected)):
		frappe.cache.set_value(key, tries + 1, expires_in_sec=LOCKOUT_SECONDS)
		left = MAX_TRIES - tries - 1
		frappe.throw(_("Wrong Clinic Manager PIN.") + (" " + _("{0} tries left.").format(left) if left > 0 else " " + _("Locked for five minutes.")))
	frappe.cache.delete_value(key)
