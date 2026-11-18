"""Weekly duty rota for the clinic team.

Codes: M morning shift, A afternoon shift, O off day, x not on duty (weekend off).
Rules the generator keeps:
  * every person has exactly one afternoon shift and one off day Monday to Friday, all other weekdays are mornings;
  * each weekday has one afternoon shift and one off day (so with five staff there is always cover);
  * Saturday and Sunday: two people on the morning shift (the same two both days), everyone else is off (x);
  * one person is on call for the week, taking turns in a fixed order.
Everything rotates week by week, and the weekend pair is chosen by fairness: whoever has worked the fewest recent weekends goes next.
"""

from datetime import timedelta

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKEND_PEOPLE = 2
CYCLE = 4  # rota weeks are numbered 1 to 4, then round again
# afternoon day (0 = Monday) of each person in week one of the cycle, by position on the rota
AFTERNOON_BASE = [2, 0, 3, 4, 1]
OFF_AFTER_AFTERNOON = 2  # the off day falls this many days after the afternoon shift


def monday_of(d):
	return d - timedelta(days=d.weekday())


def weeks_since(anchor, week_start):
	return (monday_of(week_start) - monday_of(anchor)).days // 7


def week_label(anchor, week_start):
	return f"Week {weeks_since(anchor, week_start) % CYCLE + 1}"


def build(staff, n, history=None):
	"""staff: [{"name", "on_call_order"}] in rota order. n: weeks since week one.
	history: [(week index, [names who worked that weekend])] for fairness. Returns {"rows": {name: [7 codes]}, "on_call": name}."""
	m = len(staff)
	if not m:
		return {"rows": {}, "on_call": None}
	history = history or []
	recent = [h for h in history if h[0] < n][-8:]
	worked = {s["name"]: 0 for s in staff}
	last = {s["name"]: -999 for s in staff}
	for week, names in recent:
		for name in names:
			if name in worked:
				worked[name] += 1
				last[name] = max(last[name], week)
	# weekend pair: fewest recent weekends, then the longest since the last one, then rota position (rotating with the week)
	order = sorted(range(m), key=lambda i: (worked[staff[i]["name"]], last[staff[i]["name"]], (i - 2 - WEEKEND_PEOPLE * n) % m))
	weekend = {staff[i]["name"] for i in order[:min(WEEKEND_PEOPLE, m)]}

	shift = (OFF_AFTER_AFTERNOON + (n // 5) % 2) % 5 or OFF_AFTER_AFTERNOON  # the gap changes every five weeks for variety
	rows = {}
	for i, s in enumerate(staff):
		a = ((AFTERNOON_BASE[i] if i < len(AFTERNOON_BASE) else i) + n) % 5
		o = (a + shift) % 5
		row = ["M"] * 5
		row[a], row[o] = "A", "O"
		row += ["M", "M"] if s["name"] in weekend else ["x", "x"]
		rows[s["name"]] = row
	by_turn = sorted(staff, key=lambda s: (s.get("on_call_order") or 0))
	return {"rows": rows, "on_call": by_turn[n % m]["name"], "weekend": sorted(weekend)}


def check(rows):
	"""Problems with a rota (as edited by hand): [] when it follows the rules."""
	problems = []
	for name, row in rows.items():
		week = row[:5]
		if week.count("A") != 1:
			problems.append(f"{name} has {week.count('A')} afternoon shifts Monday to Friday (should be one)")
		if week.count("O") != 1:
			problems.append(f"{name} has {week.count('O')} off days Monday to Friday (should be one)")
		if row[5] != row[6]:
			problems.append(f"{name} works only one day of the weekend")
	for d, label in ((5, "Saturday"), (6, "Sunday")):
		on = sum(1 for r in rows.values() if r[d] == "M")
		if on != WEEKEND_PEOPLE:
			problems.append(f"{label} has {on} people on the morning shift (should be {WEEKEND_PEOPLE})")
	for d, label in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]):
		if not any(r[d] == "M" for r in rows.values()):
			problems.append(f"Nobody is on the morning shift on {label}")
		if not any(r[d] == "A" for r in rows.values()):
			problems.append(f"Nobody is on the afternoon shift on {label}")
	return problems
