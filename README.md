### Clinic

Clinic module for Mutara Orchards Ltd. Built on Frappe / ERPNext version-16, using the same desk design, popups and
workflow as the Bilashaka clinic.

### Patient journey

Walk-in → Triage → Consultation → Pharmacy.

Clinic Patient → Clinic Visit → Clinic Triage → Clinic Consultation → Clinic Dispensing.

The clinic serves Mutara Orchards **employees only** (job applicants are registered the same way for their
pre-employment medical). Employees can be picked from the ERPNext Employee list or typed in with a staff number.

`Clinic Visit.status` is the queue: Waiting Triage, Waiting Consultation, In Consultation, Waiting Pharmacy,
Completed, Cancelled. A visit's **purpose** is Consultation, Pre-Employment Medical or Post-Employment Medical.

The consultation is where everything is recorded, in tabs: Patient Biodata, History (complaints, history of presenting
illness, review of systems CNS / GIT / GUT / CVS / RS / MS, past history), Physical Examination, Medical Examination
(pre / post-employment only), Diagnosis, Plan | Treatment (investigations, treatment, referral, follow-up) and
Prescriptions.

There is no laboratory or imaging on site. Requested investigations are printed as a **referral form** (Lab or Imaging)
for the patient to take to an external facility. Employment medicals print a **medical report** with the fitness outcome.

Web pages (login and role required): `/clinic/triage`, `/clinic/consultation`, `/clinic/pharmacy`, `/clinic/attendance`, `/clinic/firstaid`, `/clinic/insights` (Clinic Insights: Doctor and Clinic Manager).
Printouts: `/clinic/referral?consultation=…&type=Laboratory|Imaging`, `/clinic/certificate?consultation=…`.

Roles: Clinic Receptionist, Clinic Nurse, Clinic Doctor, Clinic Pharmacist, Clinic Manager.
Letterhead details are edited in **Clinic Settings**.

### Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch version-16
bench --site your.site install-app clinic
```

### License

mit
