# Upande Clinic

Clinic modules for Upande farms. Each clinic is a Frappe app named `clinic` that lives on its own branch of this
repository. The branches are independent: a change on one never affects the other.

| Clinic | Branch | Notes |
|---|---|---|
| Mutara Orchards | `mutara` | Employees only. Triage, consultation, pharmacy, first aid, biometric attendance, access guard, idle lock |
| Bilashaka | `bilashaka` | Frappe/ERPNext v16 |

`main` holds only this file. Do not deploy `main`.

## Deploying

Both apps are called `clinic`, so they cannot be installed on the same bench. Give each clinic its own bench or
site group, and point its app at this repository with the clinic's branch (`mutara` or `bilashaka`).

```
bench get-app clinic https://github.com/worksonmylocal/UpandeClinic.git --branch mutara
```

## Working on a clinic

```
git clone -b mutara https://github.com/worksonmylocal/UpandeClinic.git
```

Commit and push to that branch only. To copy a fix from one clinic to the other, use `git cherry-pick`; the two
branches have different histories, so never merge one into the other.
