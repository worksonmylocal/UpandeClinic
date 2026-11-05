"""Clinic touches are now numbered by position in the person's day (1st in, 2nd out, 3rd in...), not by the device's own In/Out."""

from clinic import attendance


def execute():
	attendance.relabel()
