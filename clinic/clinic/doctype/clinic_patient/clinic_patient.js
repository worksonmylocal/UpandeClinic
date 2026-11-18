frappe.ui.form.on("Clinic Patient", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("New Visit"), () => {
				frappe.new_doc("Clinic Visit", { patient: frm.doc.name });
			});
			frm.add_custom_button(__("Visit History"), () => {
				frappe.set_route("List", "Clinic Visit", { patient: frm.doc.name });
			}, __("View"));
		}
		if (frm.doc.patient_type === "Community Member" && frm.doc.is_dependant) {
			frm.add_custom_button(__("Change Parent / Farm"), () => dependant_dialog(frm), __("Dependant"));
		}
	},

	patient_type(frm) {
		if (frm.doc.patient_type === "Community Member") {
			frm.set_value("employee", null);
			frm.set_value("department", null);
		} else {
			frm.set_value("is_dependant", 0);
		}
	},

	is_dependant(frm) {
		if (frm.doc.is_dependant) {
			dependant_dialog(frm);
		} else {
			["dependant_farm", "dependant_relationship", "parent_employee", "parent_patient", "parent_name"].forEach((f) => frm.set_value(f, null));
		}
	},
});

function dependant_dialog(frm) {
	let uses_records = false, saved = false;
	const d = new frappe.ui.Dialog({
		title: __("Dependant: whose farm is billed?"),
		fields: [
			{
				fieldname: "farm", fieldtype: "Link", options: "Clinic Employer", label: __("Farm the employee works for"), reqd: 1,
				default: frm.doc.dependant_farm,
				onchange() { refresh_parent(this.get_value()); },
			},
			{ fieldname: "relationship", fieldtype: "Select", label: __("Relationship to the employee"), options: "\nSpouse\nSon\nDaughter\nParent\nSibling\nOther", default: frm.doc.dependant_relationship },
			{
				fieldname: "parent_employee", fieldtype: "Link", options: "Employee", label: __("Employee"), hidden: 1,
				default: frm.doc.parent_employee,
				description: __("Pick the employee from the farm's Employee list"),
			},
			{
				fieldname: "parent_patient", fieldtype: "Link", options: "Clinic Patient", label: __("Employee"), hidden: 1,
				default: frm.doc.parent_patient,
				get_query: () => ({ filters: { patient_type: "Employee", employer: d.get_value("farm") } }),
				description: __("Employees of this farm already registered here"),
			},
			{ fieldname: "add_parent", fieldtype: "Button", label: __("Employee not listed? Add them"), hidden: 1, click: () => add_parent_dialog(d.get_value("farm"), (r) => { d.set_value("parent_patient", r.name); }) },
		],
		primary_action_label: __("Save"),
		primary_action(v) {
			const parent = uses_records ? v.parent_employee : v.parent_patient;
			if (!parent) return frappe.msgprint(__("Select the employee this dependant belongs to"));
			frm.set_value("dependant_farm", v.farm);
			frm.set_value("dependant_relationship", v.relationship || null);
			frm.set_value("parent_employee", uses_records ? v.parent_employee : null);
			frm.set_value("parent_patient", uses_records ? null : v.parent_patient);
			frm.set_value("parent_name", null);
			saved = true;
			d.hide();
			frappe.show_alert({ message: __("Bills for this patient will go to {0}", [v.farm]), indicator: "green" });
		},
		secondary_action_label: __("Cancel"),
		secondary_action() { d.hide(); },
	});
	d.onhide = () => { if (!saved && (!frm.doc.dependant_farm || !(frm.doc.parent_employee || frm.doc.parent_patient))) frm.set_value("is_dependant", 0); };

	function refresh_parent(farm) {
		if (!farm) return;
		frappe.db.get_value("Clinic Employer", farm, "uses_employee_records").then((r) => {
			uses_records = !!(r.message && r.message.uses_employee_records);
			d.set_df_property("parent_employee", "hidden", uses_records ? 0 : 1);
			d.set_df_property("parent_employee", "reqd", uses_records ? 1 : 0);
			d.set_df_property("parent_patient", "hidden", uses_records ? 1 : 0);
			d.set_df_property("parent_patient", "reqd", uses_records ? 0 : 1);
			d.set_df_property("add_parent", "hidden", uses_records ? 1 : 0);
		});
	}
	d.show();
	if (frm.doc.dependant_farm) refresh_parent(frm.doc.dependant_farm);
}

function add_parent_dialog(farm, done) {
	const d = new frappe.ui.Dialog({
		title: __("Add employee of {0}", [farm]),
		fields: [
			{ fieldname: "full_name", fieldtype: "Data", label: __("Full Name"), reqd: 1 },
			{ fieldname: "staff_no", fieldtype: "Data", label: __("Staff / Payroll No.") },
			{ fieldname: "phone", fieldtype: "Data", label: __("Phone") },
			{ fieldname: "national_id", fieldtype: "Data", label: __("National ID") },
			{ fieldname: "sex", fieldtype: "Link", options: "Gender", label: __("Sex") },
		],
		primary_action_label: __("Add Employee"),
		primary_action(v) {
			frappe.call({
				method: "clinic.clinic.doctype.clinic_patient.clinic_patient.add_parent_employee",
				args: { farm, ...v },
				freeze: true,
				callback: (r) => { if (r.message) { d.hide(); done(r.message); frappe.show_alert({ message: __("{0} added", [r.message.full_name]), indicator: "green" }); } },
			});
		},
	});
	d.show();
}
