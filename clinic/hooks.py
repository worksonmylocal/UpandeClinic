app_name = "clinic"
app_title = "Clinic"
app_publisher = "Mutara Orchards Ltd"
app_description = "Clinic module for Mutara Orchards Ltd"
app_email = "stevekinyanjui703@gmail.com"
app_license = "mit"

# Apps
# ------------------

required_apps = ["erpnext"]

# Shown as an app on the Apps screen of the desk
add_to_apps_screen = [
	{
		"name": "clinic",
		"logo": "/assets/clinic/images/mutara-logo.jpeg",
		"title": "Clinic",
		"route": "/desk/clinic",
		"has_permission": "clinic.check_app_permission",
		"sequence_id": 2,
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/clinic/css/clinic.css"
# app_include_js = "/assets/clinic/js/clinic.js"

# include js, css files in header of web template
# web_include_css = "/assets/clinic/css/clinic.css"
# web_include_js = "/assets/clinic/js/clinic.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "clinic/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "clinic/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "clinic.utils.jinja_methods",
# 	"filters": "clinic.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "clinic.install.before_install"
# after_install = "clinic.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "clinic.uninstall.before_uninstall"
# after_uninstall = "clinic.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "clinic.utils.before_app_install"
# after_app_install = "clinic.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "clinic.utils.before_app_uninstall"
# after_app_uninstall = "clinic.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "clinic.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "clinic.notifications.get_notification_config"

# Awesome Bar
# -----------
# Extra search results: list of dicts with label, description, route, index.
# route: ["List", "ToDo"], "/desk/docs/some/page", or "https://example.com"
# awesomebar_search = ["clinic.search.awesomebar_results"]

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"clinic.tasks.all"
# 	],
# 	"daily": [
# 		"clinic.tasks.daily"
# 	],
# 	"hourly": [
# 		"clinic.tasks.hourly"
# 	],
# 	"weekly": [
# 		"clinic.tasks.weekly"
# 	],
# 	"monthly": [
# 		"clinic.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "clinic.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "clinic.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "clinic.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "clinic.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["clinic.utils.before_request"]
# after_request = ["clinic.utils.after_request"]

# Job Events
# ----------
# before_job = ["clinic.utils.before_job"]
# after_job = ["clinic.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"clinic.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


# Installation
# ------------

before_install = "clinic.setup.before_install"
after_install = "clinic.setup.after_install"

# Scheduled Tasks
# ---------------

scheduler_events = {
	"daily": [
		"clinic.clinic.doctype.clinic_appointment.clinic_appointment.mark_missed_appointments",
	],
}

# Access control
# --------------
# Only the clinic access administrator (clinic_access_admin in site_config.json) can hand out clinic roles.

doc_events = {
	"Employee Checkin": {
		"validate": "clinic.attendance.label_checkin",
		"after_insert": "clinic.attendance.renumber_after_save",
		"on_trash": "clinic.attendance.renumber_after_save",
	},
	"User": {"validate": "clinic.access.guard_user_roles"},
	"Role Profile": {"validate": "clinic.access.guard_role_profile"},
	"Custom DocPerm": {"validate": "clinic.access.guard_permissions"},
}

# Idle screen lock: signing in again clears a lock left behind
on_login = ["clinic.api.lock.clear_on_login"]

# Adds the Clinic Log field to Employee Checkin once HRMS is on the site
after_migrate = ["clinic.attendance.ensure_custom_field"]
