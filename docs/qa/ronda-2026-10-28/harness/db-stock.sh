#!/bin/sh
psql -U postgres -h localhost -d erp -At -F ' | ' -c "select p.name, p.stock, sl.quantity_on_hand from products p left join stock_levels sl on sl.product_id=p.id where p.name like 'QA3%'" -c "select m.date, m.type, m.quantity, m.cost, m.reference, m.source_type, p.name from stock_movements m join products p on p.id=m.product_id order by m.date, m.id"
