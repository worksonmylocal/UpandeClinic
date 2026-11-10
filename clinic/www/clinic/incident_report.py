from clinic.web import prepare_page


def get_context(context):
    prepare_page(context, "incident_report", any_of=("consultation", "triage"))
