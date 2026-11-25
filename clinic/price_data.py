"""Northlake Medical Centre price lists (from the clinic's printed price lists)."""

# (drug, strength, dose days, units of issue per dose, price per dose), from the clinic's price list.
# One dose is `units` tablets / capsules (or a bottle, vial or ampoule) for `days` days of treatment.
# Liquids sold by the bottle are always one unit per dose, whatever the sheet lists.
DRUGS = [
	("Azithromycin", "500 mg", 3, 3, 200), ("Azithromycin", "250 mg", 3, 3, 100), ("Azithromycin", "15 ml", 3, 1, 100),
	("Amoxyclav", "228 mg", 5, 1, 150), ("Amoxyclav", "625 mg", 5, 10, 300), ("Amoxyclav", "1000 mg", 7, 10, 500),
	("Amoxycillin", "500 mg", 5, 15, 200), ("Ampiclox", "500 mg", 5, 15, 300), ("Ampiclox", "100 ml", 5, 1, 100),
	("Artesunate", "60 mg", 1, 1, 800), ("Aminophylline", "250 mg", 1, 1, 100), ("Adrenaline", "1 ml", 1, 1, 100),
	("Atropine", "5 ml", 1, 1, 100), ("Artemether", "", 3, 1, 100), ("Benzathine Penicillin", "2.4 MU", 1, 1, 150),
	("Benzyl Penicillin", "1,000,000 IU", 1, 1, 100), ("Buscopan (Hyoscine)", "", 1, 1, 100),
	("Cefuroxime", "500 mg", 1, 10, 300), ("Cefuroxime", "100 ml", 5, 1, 150), ("Cefixime", "400 mg", 5, 10, 300),
	("Cefixime", "200 mg", 5, 10, 150), ("Cephalexin", "500 mg", 5, 10, 200), ("Cephalexin", "100 ml", 5, 1, 100),
	("Ciprofloxacin", "500 mg", 5, 10, 300), ("Chlorpheniramine", "10 mg", 1, 1, 150), ("Carbamazepine", "200 mg", 30, 30, 400),
	("Carvedilol", "12.5 mg", 30, 30, 150), ("Carvedilol", "6.25 mg", 30, 30, 400),
	("Clarithromycin", "500 mg", 14, 14, 300), ("CTX", "960 mg", 5, 10, 100), ("CTX", "100 ml", 5, 1, 50),
	("Ceftriaxone", "1 g", 3, 1, 200), ("Doxycycline", "100 mg", 5, 10, 100), ("Diclofenac Inj", "75 mg", 1, 1, 100),
	("Domperidone", "10 mg", 3, 9, 150), ("Dexamethasone Inj", "8 mg/2 ml", 1, 1, 100), ("Diazepam", "10 mg/ml", 1, 1, 100),
	("Diazepam Tabs", "5 mg", 3, 9, 100), ("Erythromycin", "500 mg", 5, 10, 300), ("Erythromycin", "250 mg", 5, 10, 250),
	("Erythromycin", "100 ml", 5, 1, 150), ("Ferroliz Tabs", "", 30, 30, 150), ("Flucloxacillin", "500 mg", 5, 10, 350),
	("Furosemide", "20 mg", 30, 30, 150), ("Fluconazole", "200 mg", 5, 5, 200), ("Fluconazole", "150 mg", 3, 1, 150),
	("Flucloxacillin", "250 mg", 5, 10, 250), ("Flucloxacillin", "100 ml", 5, 1, 150), ("Gentamicin", "80 mg", 1, 1, 100),
	("Glucomet", "500 mg", 28, 28, 150), ("Griseofulvin", "500 mg", 30, 30, 300), ("Griseofulvin", "250 mg", 30, 30, 200),
	("Griseofulvin", "125 mg", 30, 30, 100), ("Gastrogel", "10 ml", 5, 1, 100), ("Enalapril", "5 mg", 30, 30, 150),
	("Esomeprazole Inj", "20 mg", 1, 1, 100), ("Hemoforce", "200 ml", 7, 1, 250), ("Hydrocortisone Inj", "100 mg", 1, 1, 100),
	("IV Ringers Lactate", "500 ml", 1, 1, 200), ("IV Dex 5%", "500 ml", 1, 1, 200), ("IV Normal Saline", "500 ml", 1, 1, 200),
	("Norfloxacin", "400 mg", 5, 10, 150), ("Nogluc (Glibenclamide)", "5 mg", 28, 28, 200), ("Pregabalin", "75 mg", 30, 30, 200),
	("Paracetamol Inj Infusion", "", 1, 1, 100), ("Tramadol Inj", "100 mg", 1, 1, 100), ("H. pylori Kit", "", 14, 14, 2000),
	("Methyldopa", "250 mg", 30, 30, 150), ("Metoclopramide Inj", "", 1, 1, 100), ("Metronidazole Inj", "100 ml", 1, 1, 100),
	("Nitrofurantoin", "100 mg", 5, 10, 100), ("Tranexamic Acid", "500 mg", 1, 1, 100), ("Presartan H", "50 mg", 28, 28, 150),
	("Clindamycin", "300 mg", 5, 10, 400), ("Ventolin Inhaler", "", 1, 1, 300), ("Symbicort Inhaler", "", 30, 1, 3200),
]
# sheet drug + strength -> the Item that already exists for it (the stock list and earlier price lists name some differently)
ITEM_ALIASES = {
	"Norfloxacin 400 mg": "norfloxacin", "Nitrofurantoin 100 mg": "nitrofurantoin", "Methyldopa 250 mg": "Methyldopa 250 mg",
	"H. pylori Kit": "H. pylori Kit", "Tramadol Inj 100 mg": "tramadol inj", "Paracetamol Inj Infusion": "iv paracetamol infusion",
	"Metronidazole Inj 100 ml": "IV Metronidazole 500 mg", "Tranexamic Acid 500 mg": "Tranexamic Acid Inj 500 mg",
	"Dexamethasone Inj 8 mg/2 ml": "Dexamethasone Inj 5 mg/ml",
}
# sold as a single pack (bottle, sachet) whatever the days of treatment listed
PACK_SIZES = {"ml"}


def course_qty(strength, units):
	return 1 if strength.split(" ")[-1] in PACK_SIZES else units


def item_name(drug, strength):
	name = f"{drug} {strength}".strip()
	return ITEM_ALIASES.get(name, name)


# lab test type -> price. Free tests carry no charge, so they are left out.
LAB_PRICES = {
	"Urinalysis": 200, "Random Blood Sugar": 200, "Fasting Blood Sugar": 200, "Prostate Specific Antigen (PSA)": 500,
	"Malaria Test (BS for MPs)": 300, "Malaria RDT": 300, "Stool Analysis": 300, "Haemoglobin": 200,
	"Blood Group & Rhesus": 200, "VDRL (Syphilis)": 300, "ASOT": 500, "BAT (Brucella Agglutination Test)": 500,
	"Rheumatoid Factor (RF)": 500, "H. Pylori": 500, "H. Pylori Ab": 500, "Hepatitis B (HBsAg)": 300,
	"Pregnancy Test (UPT)": 200, "Salmonella Antigen Test": 350, "ANC Profile": 350,
}

# (procedure, price, note)
PROCEDURES = [
	("Injection own drugs", 100, ""), ("Delivery", 4000, ""), ("Full medical examination", 500, ""), ("Suturing", 500, ""),
	("Removal of stitches", 100, ""), ("Wound dressing", 100, ""), ("Eye irrigation", 100, ""),
	("Incision & Drainage (I&D)", 400, ""), ("Nebulization", 500, ""),
	("Norplan insertion", 0, "Free if commodities are available"), ("Norplan removal", 500, ""),
	("IUCD insertion", 0, "Free if commodities are available"), ("IUCD removal", 500, ""),
	("Depo injection", 0, "Free if commodities are available"), ("COC pills", 0, "Free if commodities are available"),
]

VISIT_FEES = {"mch_first_visit": 50, "mch_revisit": 0, "anc_first_visit": 350, "anc_revisit": 100}

from clinic.seed_data import LAB_TEST_TYPES

# the ANC profile carries the lab's own urinalysis parameters
URINALYSIS_PARAMETERS = next(t for t in LAB_TEST_TYPES if t["test_name"] == "Urinalysis")["parameters"]

# tests on the price list that the clinic did not have yet
NEW_LAB_TESTS = [
	{"test_name": "Fasting Blood Sugar", "category": "Biochemistry", "sample_type": "Blood", "performed_where": "Onsite",
	 "instructions": "Patient must have fasted for at least 8 hours.",
	 "parameters": [{"parameter": "FBS", "result_type": "Numeric", "unit": "mmol/L", "normal_low": 3.9, "normal_high": 5.5}]},
	{"test_name": "Prostate Specific Antigen (PSA)", "category": "Serology", "sample_type": "Serum", "performed_where": "Onsite",
	 "parameters": [{"parameter": "PSA", "result_type": "Numeric", "unit": "ng/mL", "normal_low": 0, "normal_high": 4}]},
	{"test_name": "H. Pylori Ab", "category": "Serology", "sample_type": "Serum", "performed_where": "Onsite",
	 "parameters": [{"parameter": "H. Pylori Ab", "result_type": "Qualitative", "unit": "", "options": "Negative\nPositive"}]},
	{"test_name": "ANC Profile", "category": "Other", "sample_type": "Blood", "performed_where": "Onsite", "requires_consent": 1,
	 "instructions": "Antenatal profile: Hb, blood group, VDRL, HBsAg, blood sugar and a full urinalysis.",
	 "parameters": [
		{"parameter": "Haemoglobin", "result_type": "Numeric", "unit": "g/dL", "normal_low": 11, "normal_high": 16},
		{"parameter": "ABO Group", "result_type": "Qualitative", "unit": "", "options": "A\nB\nAB\nO"},
		{"parameter": "Rhesus", "result_type": "Qualitative", "unit": "", "options": "Rh Positive\nRh Negative"},
		{"parameter": "VDRL", "result_type": "Qualitative", "unit": "", "options": "Non-reactive\nReactive"},
		{"parameter": "HBsAg", "result_type": "Qualitative", "unit": "", "options": "Negative\nPositive"},
		{"parameter": "Blood Sugar", "result_type": "Numeric", "unit": "mmol/L", "normal_low": 3.9, "normal_high": 7.8},
	 ] + [dict(p, param_group="Urinalysis") for p in URINALYSIS_PARAMETERS]},
]
