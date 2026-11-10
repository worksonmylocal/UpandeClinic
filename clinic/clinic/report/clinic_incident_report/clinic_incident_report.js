frappe.query_reports["Clinic Incident Report"] = {
	filters: [
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date", default: frappe.datetime.month_start(), reqd: 1 },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date", default: frappe.datetime.month_end(), reqd: 1 },
		{ fieldname: "report_type", label: __("Type"), fieldtype: "Select", options: "\nAccident\nIncident\nNear Miss" },
		{ fieldname: "severity", label: __("Severity"), fieldtype: "Select", options: "\nMinor\nModerate\nSevere\nFatal" },
		{ fieldname: "patient_type", label: __("Patient type"), fieldtype: "Select", options: "\nEmployee\nCommunity Member" },
		{ fieldname: "work_related", label: __("Work-related only"), fieldtype: "Check" },
	],
};
