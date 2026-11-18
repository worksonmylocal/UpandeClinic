import frappe

# (name, on-call turn): on call goes Abigael, Edward, Karen, Peris, Caren, as on the paper rota. The list is in rota order.
STAFF = [("Abigael Kemboi", 1), ("Caren Kimeli", 5), ("Edward Omwoa", 2), ("Karen Jerop", 3), ("Peris Odero", 4)]


def execute():
	"""Put the five clinic staff on the duty rota and start the cycle on Monday 2 Nov 2026, so 16 Nov is week 3."""
	settings = frappe.get_doc("Clinic Settings")
	if not settings.rota_anchor:
		settings.rota_anchor = "2026-11-02"
	if not settings.rota_staff:
		for name, order in STAFF:
			settings.append("rota_staff", {"staff_name": name, "on_call_order": order, "active": 1})
	settings.flags.ignore_permissions = True
	settings.save()
