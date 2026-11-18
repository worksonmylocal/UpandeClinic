frappe.query_reports["Clinic Dependants Cost"] = {
	filters: [
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date", default: frappe.datetime.month_start(), reqd: 1 },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
		{ fieldname: "farm", label: __("Farm"), fieldtype: "Link", options: "Clinic Employer" },
	],
};
