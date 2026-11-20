"""Lab statistics: tests done and how many were positive, low, high or abnormal, for the lab's monthly returns."""
import re

import frappe
from frappe import _
from frappe.utils import flt

MALARIA = ("Malaria Test (BS for MPs)", "Malaria RDT")
SAT = "Salmonella Antigen Test"
NONE_WORDS = {"", "neg", "negative", "nil", "none", "absent", "-", "--", "normal", "not seen", "nil seen", "non reactive",
	"non-reactive", "nr", "n/a", "na", "clear"}

# urinalysis parameters, in the order the lab reads them (old names that earlier results carry are listed too)
URINE = [
	("Leucocytes", ("leucocytes",)),
	("Blood", ("blood",)),
	("Proteins", ("proteins", "protein")),
	("Nitrite", ("nitrite", "nitrites")),
	("Ketones", ("ketones",)),
	("Glucose", ("glucose",)),
	("Bilirubin", ("bilirubin",)),
	("Urobilinogen", ("urobilinogen",)),
	("Pus cells", ("pus cells",)),
	("Red blood cells", ("red blood cells",)),
	("Epithelial cells", ("epithelial cells",)),
	("Casts", ("casts",)),
	("Crystals", ("crystals",)),
	("Parasites", ("parasites", "parasites / yeast")),
	("Yeast", ("yeast", "parasites / yeast")),
]


def execute(filters=None):
	f = frappe._dict(filters or {})
	note = _("Counts are of resulted tests in the period. Under 5 means younger than 5 years. Positive for SAT means any antigen reported other than negative. Urinalysis \"with\" counts tests where that parameter was reported as anything other than negative, nil or 0.")
	return get_columns(), get_data(f), note, None


def get_columns():
	return [
		{"label": _("Test"), "fieldname": "section", "fieldtype": "Data", "width": 190},
		{"label": _("Measure"), "fieldname": "measure", "fieldtype": "Data", "width": 300},
		{"label": _("Count"), "fieldname": "count", "fieldtype": "Int", "width": 90},
	]


def present(value):
	"""A result that reports something: not blank, not negative/nil, and not a bare zero count."""
	v = (value or "").strip().lower()
	if v in NONE_WORDS:
		return False
	nums = re.findall(r"\d+(?:\.\d+)?", v)
	if nums and re.fullmatch(r"[\d\s.\-/a-z]*", v) and max(flt(n) for n in nums) == 0:
		return False
	return True


def get_data(f):
	cond = " AND t.patient_type = %(patient_type)s" if f.get("patient_type") else ""
	tests = frappe.db.sql(
		f"""SELECT t.name, t.test_type, t.age_years FROM `tabClinic Lab Test` t
		WHERE t.status = 'Resulted' AND DATE(t.resulted_on) BETWEEN %(from_date)s AND %(to_date)s {cond}""",
		f, as_dict=True,
	)
	items = {}
	if tests:
		for r in frappe.db.sql(
			"SELECT parent, parameter, value, flag FROM `tabClinic Lab Test Result Item` WHERE parent IN %(p)s",
			{"p": [t.name for t in tests]}, as_dict=True,
		):
			items.setdefault(r.parent, []).append(r)

	def param(test, *names):
		return [i for i in items.get(test.name, []) if (i.parameter or "").strip().lower() in names]

	rows = []

	def section(title, total):
		rows.append({"section": title, "measure": "", "count": total, "bold": 1})

	def line(measure, n):
		rows.append({"section": "", "measure": measure, "count": n})

	def age_band(t):
		return None if t.age_years is None else ("u5" if t.age_years < 5 else "o5")

	# malaria
	mal = [t for t in tests if t.test_type in MALARIA]
	def malaria_pos(t):
		return any((i.value or "").strip().lower().startswith("pos") or (i.flag or "").lower() == "positive"
			for i in param(t, "malaria parasites", "malaria rdt"))
	for label, band in (("Malaria, under 5 years", "u5"), ("Malaria, 5 years and above", "o5"), ("Malaria, age not recorded", None)):
		group = [t for t in mal if age_band(t) == band]
		if band is None and not group:
			continue
		section(label, len(group))
		line("Tests done", len(group))
		line("Positive", sum(1 for t in group if malaria_pos(t)))

	# salmonella antigen test
	sat = [t for t in tests if t.test_type == SAT]
	def sat_pos(t):
		return any(present(i.value) for i in items.get(t.name, []))
	for label, band in (("SAT, under 5 years", "u5"), ("SAT, 5 years and above", "o5"), ("SAT, age not recorded", None)):
		group = [t for t in sat if age_band(t) == band]
		if band is None and not group:
			continue
		section(label, len(group))
		line("Tests done", len(group))
		line("Positive", sum(1 for t in group if sat_pos(t)))

	# haemoglobin (the Haemoglobin test and the Hb in the ANC profile)
	hb = [flt(i.value) for t in tests for i in param(t, "haemoglobin") if (i.value or "").strip() != ""]
	section("Haemoglobin (Hb)", len(hb))
	line("Tests done", len(hb))
	line("Below 5 g/dL", sum(1 for v in hb if v < 5))
	line("5 to 10 g/dL", sum(1 for v in hb if 5 <= v <= 10))

	# random blood sugar
	rbs = [i for t in tests for i in param(t, "rbs") if (i.value or "").strip() != ""]
	section("Random blood sugar (RBS)", len(rbs))
	line("Tests done", len(rbs))
	line("Low", sum(1 for i in rbs if (i.flag or "").lower() == "low" or (not i.flag and flt(i.value) < 3.9)))
	line("High", sum(1 for i in rbs if (i.flag or "").lower() == "high" or (not i.flag and flt(i.value) > 7.8)))

	# urinalysis (the Urinalysis test and the urinalysis in the ANC profile)
	urine = [t for t in tests if t.test_type == "Urinalysis" or (t.test_type == "ANC Profile" and param(t, "pus cells", "glucose", "ketones"))]
	section("Urinalysis", len(urine))
	line("Tests done", len(urine))
	for label, names in URINE:
		line(f"With {label.lower()}", sum(1 for t in urine if any(present(i.value) for i in param(t, *names))))
	return rows
