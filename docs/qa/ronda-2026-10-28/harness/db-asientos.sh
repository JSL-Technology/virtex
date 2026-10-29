#!/bin/sh
# Muestra los asientos (y líneas) creados después de una marca de tiempo.
psql -U postgres -h localhost -d erp -At -F ' | ' -c "
select je.entry_number, je.date, je.status, coalesce(je.currency_code,'NULL'), je.\"entryType\", left(je.description,50), a.code, left(a.name::text,40), l.debit, l.credit
from journal_entries je join journal_entry_lines l on l.journal_entry_id=je.id join accounts a on a.id=l.account_id
where je.created_at > '${1:-2000-01-01}' order by je.created_at, je.entry_number, l.debit desc;"
